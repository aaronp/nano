/**
 * Subscriptions as data: their shape, their live/waiting/broken status, the edits on them (each policed), the cascade
 * when an end is unregistered, and the books of the messages over each.
 *
 *   const s: SubscriptionData = { id: 's1', kind: 'call', from: 'acme/app/main#0', to: 'acme/db/mem#0' }
 *   statusOf(s, end)        // 'live' | 'waiting' | 'broken'
 *   const subs = subscriptionTable({ id, policy, trace, end, gone })
 *   subs.subscribe(s); subs.cascade('acme/db/mem#0')
 */
import { portKey } from '../iface.ts'
import { fits, type Op } from '../op.ts'
import type { Implementation } from '../implementation.ts'
import type { PodState } from '../pod.ts'
import type { Policy } from '../policy.ts'
import { failure, success, type NanoResult } from '../result.ts'
import type { Book } from './calls.ts'
import { ID, MAX_SUBSCRIPTIONS, parseInstance } from './pods.ts'
import type { Tracer } from './trace.ts'

/** `from`/`to` are coords; an event's `source`/`target` are port keys (`portKey(ifaceCoord, opCoord)`). */
export type SubscriptionData =
  | { id: string; kind: 'call'; from: string; to: string }
  | { id: string; kind: 'event'; from: string; source: string; to: string; target: string }

/** A subscription as given to `subscribe`: the id is optional. Distributes over the union (a plain Omit would drop `source`/`target`). */
export type NewSubscription = SubscriptionData extends infer S ? (S extends SubscriptionData ? Omit<S, 'id'> & { id?: string } : never) : never

export type Status = 'live' | 'waiting' | 'broken'

const portOp = (impl: Implementation, port: string): Op | undefined =>
  impl.provides.flatMap(i => [...i.byCoord.values()].filter(o => portKey(i.coord, o.coord) === port))[0]
/** A registered end: its pod's state and implementation. */
type End = { state: PodState; impl: Implementation }

/** Waiting while an end is not registered, failed or stopped (starting is available); broken when the ends do not fit. */
export function statusOf(s: SubscriptionData, end: (coord: string) => End | undefined): Status {
  const a = end(s.from), b = end(s.to)
  if (!a || !b || [a.state, b.state].some(x => x === 'failed' || x === 'stopped')) return 'waiting'
  if (s.kind === 'event') {
    const src = portOp(a.impl, s.source), dst = portOp(b.impl, s.target)
    return src?.kind === 'source' && dst && dst.kind !== 'source' && fits(src, dst) ? 'live' : 'broken'
  }
  const wanted = Object.values(a.impl.dependencies).flatMap(d => (d.implements === undefined ? [] : [d.implements]))
  return wanted.length === 0 || b.impl.provides.some(i => wanted.includes(i.coord)) ? 'live' : 'broken'
}

/** Why this subscription's shape is unusable, or undefined when it is fine. */
export function invalid(s: SubscriptionData): string | undefined {
  if (s.kind !== 'call' && s.kind !== 'event') return `unknown subscription kind ${String((s as { kind: unknown }).kind)}`
  for (const end of [s.from, s.to]) if (typeof end !== 'string' || !parseInstance(end)) return `${String(end)} is not a coord`
  if (s.kind === 'event' && !(typeof s.source === 'string' && s.source && typeof s.target === 'string' && s.target))
    return 'an event subscription needs a source and a target port'
}

export function nextId(subs: readonly SubscriptionData[]): string {
  const taken = new Set(subs.map(s => s.id))
  let n = 1
  while (taken.has(`s${n}`)) n++
  return `s${n}`
}

/** The consumer's call subscriptions keep their array slots, refilled in the given order; undefined unless `ids` is exactly that set. */
export function reordered(subs: readonly SubscriptionData[], consumer: string, ids: readonly string[]): SubscriptionData[] | undefined {
  const mine = subs.filter(s => s.kind === 'call' && s.from === consumer)
  if (ids.length !== mine.length || new Set(ids).size !== ids.length || !ids.every(id => mine.some(s => s.id === id))) return undefined
  const queue = ids.map(id => mine.find(s => s.id === id)!)
  return subs.map(s => (s.kind === 'call' && s.from === consumer ? queue.shift()! : s))
}

/** One runtime's subscriptions. `gone(coord)`: the coord was unregistered here (never reused), so naming it is not-found. */
export function subscriptionTable(rt: { id: string; policy: Policy; trace: Tracer; end(coord: string): End | undefined; gone(coord: string): boolean }) {
  const { id, trace: { emit } } = rt
  let subs: SubscriptionData[] = []
  const statuses = new Map<string, Status>(), books = new Map<string, Book>()
  const recompute = (only: readonly SubscriptionData[] = subs) => {
    for (const s of only) {
      const now = statusOf(s, rt.end)
      if (statuses.get(s.id) !== now) { statuses.set(s.id, now); emit({ type: 'status', id: s.id, status: now }) }
    }
  }
  const drop = (sid: string, reason: 'unsubscribed' | 'cascade') => {
    subs = subs.filter(s => s.id !== sid)
    statuses.delete(sid)
    books.delete(sid)
    emit({ type: 'subscription-removed', id: sid, reason })
  }
  const bad = (s: SubscriptionData): NanoResult<never> | undefined => {
    const why = invalid(s)
    if (why) return failure('invalid-input', why)
    for (const c of [s.from, s.to]) if (rt.gone(c)) return failure('not-found', `${c} was unregistered from ${id}`)
  }
  /** The first denial among these subscriptions, as a fail; a throwing policy is a denial, and a failure on the stream. */
  const denied = (list: readonly SubscriptionData[]): NanoResult<never> | undefined => {
    for (const s of list) {
      let v
      try { v = rt.policy.isAllowed(s.from, s.to, s) } catch (e) {
        const why = `policy threw: ${e instanceof Error ? e.message : String(e)}`
        emit({ type: 'failure', coord: s.from, reason: why })
        return failure('denied', why)
      }
      if (!v.approved) return failure('denied', v.reason)
    }
  }
  return {
    list: () => subs, statuses, books, recompute,
    /** Every subscription naming `coord` is deleted (it is gone, not unavailable). */
    cascade(coord: string) {
      for (const s of subs.filter(s => s.from === coord || s.to === coord)) drop(s.id, 'cascade')
    },
    subscribe(input: NewSubscription): NanoResult<SubscriptionData> {
      const sid = input.id ?? nextId(subs)
      if (typeof sid !== 'string' || !ID.test(sid)) return failure('invalid-input', `bad subscription id ${JSON.stringify(sid)}`)
      if (subs.some(s => s.id === sid)) return failure('exists', `subscription ${sid} exists`)
      if (subs.length >= MAX_SUBSCRIPTIONS) return failure('invalid-input', `${id} would hold more than ${MAX_SUBSCRIPTIONS} subscriptions`)
      const s = { ...input, id: sid } as SubscriptionData
      const no = bad(s) ?? denied([s])
      if (no) return no
      subs.push(s)
      emit({ type: 'subscription-set', subscription: s })
      recompute([s]) // a new subscription changes no other's status
      return success(s)
    },
    unsubscribe(sid: string): NanoResult<void> {
      if (!subs.some(s => s.id === sid)) return failure('not-found', `no subscription ${sid}`)
      drop(sid, 'unsubscribed')
      return success(undefined)
    },
    retarget(sid: string, to: string): NanoResult<void> {
      const i = subs.findIndex(s => s.id === sid)
      if (i < 0) return failure('not-found', `no subscription ${sid}`)
      const s = { ...subs[i]!, to }
      const no = bad(s) ?? denied([s])
      if (no) return no
      subs[i] = s
      emit({ type: 'subscription-set', subscription: s })
      recompute([s])
      return success(undefined)
    },
    reorder(consumer: string, ids: string[]): NanoResult<void> {
      const next = reordered(subs, consumer, ids)
      if (!next) return failure('not-found', `${ids.join(', ')} is not exactly ${consumer}'s call subscriptions`)
      const no = denied(next.filter(s => ids.includes(s.id)))
      if (no) return no
      subs = next
      for (const sid of ids) emit({ type: 'subscription-set', subscription: subs.find(s => s.id === sid)! })
      return success(undefined)
    },
  }
}
