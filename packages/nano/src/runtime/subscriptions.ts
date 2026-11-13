/**
 * Subscriptions as data: their shape, their live/waiting/broken status, ids and a consumer's call order.
 *
 *   const s: SubscriptionData = { id: 's1', kind: 'call', from: 'main#0', to: 'db#0' }
 *   statusOf(s, coord => locate(pods, coord), runtime.id)   // 'live' | 'waiting' | 'broken'
 */
import { fits } from '../op.ts'
import { parseInstance, portOp, type Instance, type PodRecord } from './pods.ts'

/** `from`/`to` are instance coords; an event's `source`/`target` are port keys (`portKey(ifaceCoord, opCoord)`). */
export type SubscriptionData =
  | { id: string; kind: 'call'; from: string; to: string }
  | { id: string; kind: 'event'; from: string; source: string; to: string; target: string }

/** A subscription as given to `subscribe`: the id is optional. Distributes over the union (a plain Omit would drop `source`/`target`). */
export type NewSubscription = SubscriptionData extends infer S ? (S extends SubscriptionData ? Omit<S, 'id'> & { id?: string } : never) : never

export type Status = 'live' | 'waiting' | 'broken'

/**
 * Waiting while an end is missing or its instance is not running. In runtime `runtime`: a call from a pod placed here
 * (home elsewhere) is broken, since it calls out through its home (decision 11).
 */
export function statusOf(s: SubscriptionData, locate: (coord: string) => { pod: PodRecord; instance: Instance } | undefined, runtime: string): Status {
  const a = locate(s.from), b = locate(s.to)
  if (a?.instance.state !== 'running' || b?.instance.state !== 'running') return 'waiting'
  const from = a.pod.implementation, to = b.pod.implementation
  if (s.kind === 'call' && a.pod.home !== runtime) return 'broken'
  if (s.kind === 'event') {
    const src = portOp(from, s.source)
    const dst = portOp(to, s.target)
    return src?.kind === 'source' && dst && dst.kind !== 'source' && fits(src, dst) ? 'live' : 'broken'
  }
  const wanted = Object.values(from.dependencies).flatMap(d => (d.implements === undefined ? [] : [d.implements]))
  return wanted.length === 0 || to.provides.some(i => wanted.includes(i.coord)) ? 'live' : 'broken'
}

/** Why this subscription's shape is unusable, or undefined when it is fine. */
export function invalid(s: SubscriptionData): string | undefined {
  if (s.kind !== 'call' && s.kind !== 'event') return `unknown subscription kind ${String((s as { kind: unknown }).kind)}`
  for (const end of [s.from, s.to]) if (typeof end !== 'string' || !parseInstance(end)) return `${String(end)} is not an instance coord`
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
