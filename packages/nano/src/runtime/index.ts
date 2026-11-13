/**
 * The runtime: members and their lifecycle (provisioned on create when asked), subscriptions as data with live/waiting/broken status, policy on every rewire, books per subscription.
 *
 *   const rt = createRuntime('r1', { registry })
 *   await rt.create('b', 'acme/log/mem', { provision: true })             // NanoResult<{ coord: 'acme/log/mem#b', unsatisfied: [] }>
 *   rt.subscribe({ kind: 'call', from: 'acme/app/main#a', to: 'acme/log/mem#b' }); rt.status('s1')   // 'waiting': no acme/app/main#a yet
 *   rt.books('s1')                                                        // { calls: 0 }
 */
import type { Implementation } from '../implementation.ts'
import { createHostPod, type Observation, type Pod } from '../pod.ts'
import { Policies, type Policy } from '../policy.ts'
import type { Registry } from '../registry.ts'
import { failure, success, type NanoResult } from '../result.ts'
import type { SelectorData, Target } from '../selector.ts'
import { connectionsOf, contextFor, deliverer, join, leave, type Book, type Wiring } from './calls.ts'
import { cycleReason, provision, type Unsatisfied } from './provision.ts'
import { instanceCoord, parseInstance, targetOf, type Member } from './members.ts'
import { invalid, nextId, reordered, statusOf, type NewSubscription, type Status, type SubscriptionData } from './subscriptions.ts'

export * from './members.ts'
export * from './subscriptions.ts'
export type { Book } from './calls.ts'
export type { Unsatisfied } from './provision.ts'

export type RuntimeEvent =
  | { type: 'instance-added'; instance: string; home: string }
  | { type: 'instance-removed'; instance: string }
  | { type: 'instance-replaced'; from: string; to: string }
  | { type: 'subscription-set'; subscription: SubscriptionData }
  | { type: 'subscription-removed'; id: string }
  | { type: 'status'; id: string; status: Status }

export type Runtime = {
  readonly id: string
  readonly registry: Registry
  readonly policy: Policy
  /** With `provision: true`, connects or makes what its dependencies need; `unsatisfied` lists the rest (`not provisioned` without it). */
  create(id: string, implementation: string, opts?: { config?: unknown; provision?: boolean }): Promise<NanoResult<{ coord: string; unsatisfied: Unsatisfied[] }>>
  add(m: Member): NanoResult<void>
  remove(coord: string): NanoResult<void>
  replace(coord: string, implementation: string, opts?: { config?: unknown }): Promise<NanoResult<string>>
  member(coord: string): Member | undefined
  members(): readonly string[]
  target(coord: string): Target | undefined
  subscribe(s: NewSubscription): NanoResult<SubscriptionData>
  unsubscribe(id: string): NanoResult<void>
  retarget(id: string, to: string): NanoResult<void>
  reorder(consumer: string, ids: string[]): NanoResult<void>
  subscriptions(): readonly SubscriptionData[]
  status(id: string): Status | undefined
  /** Messages delivered over a subscription (calls and event deliveries) and the last result; undefined for an unknown id. */
  books(id: string): Book | undefined
  listen(fn: (e: RuntimeEvent) => void): () => void
}

export type RuntimeOpts = {
  registry: Registry
  policy?: Policy
  tagsOf?: (coord: string) => ReadonlySet<string>
  idTaken?: (id: string) => boolean
  pod?: { timeoutMs?: number; observe?(o: Observation): void }
}

export function createRuntime(id: string, opts: RuntimeOpts): Runtime {
  const { registry } = opts
  const policy = opts.policy ?? Policies.allowAll()
  let members = new Map<string, Member>() // insertion order is create order; saving relies on it
  let subs: SubscriptionData[] = []
  const statuses = new Map<string, Status>()
  const listeners = new Set<(e: RuntimeEvent) => void>()
  const books = new Map<string, Book>()
  const target = (coord: string): Target | undefined => {
    const m = members.get(coord)
    return m && targetOf(m, opts.tagsOf?.(coord) ?? new Set())
  }
  const wiring: Wiring = {
    id, policy, books, target,
    subscriptions: () => subs,
    status: sid => statuses.get(sid),
    member: c => members.get(c),
    observe: o => opts.pod?.observe?.(o),
  }
  const deliver = deliverer(wiring)

  const emit = (e: RuntimeEvent) => {
    for (const fn of listeners) try { fn(e) } catch { /* a listener must never break the runtime */ }
  }
  const recompute = () => {
    for (const s of subs) {
      const now = statusOf(s, c => members.get(c))
      if (statuses.get(s.id) !== now) { statuses.set(s.id, now); emit({ type: 'status', id: s.id, status: now }) }
    }
  }
  const bad = (s: SubscriptionData): NanoResult<never> | undefined => {
    const why = invalid(s)
    if (why) return failure('invalid-input', why)
  }
  /** The first denial among these subscriptions, as a fail. */
  const denied = (list: readonly SubscriptionData[]): NanoResult<never> | undefined => {
    for (const s of list) {
      let v
      try { v = policy.isAllowed(s.from, s.to, s) } catch (e) {
        const why = `policy threw: ${e instanceof Error ? e.message : String(e)}`
        try { opts.pod?.observe?.({ kind: 'exception', instance: s.from, op: s.id, error: why }) } catch { /* an observer must never break a rewire */ }
        return failure('denied', why)
      }
      if (!v.approved) return failure('denied', v.reason)
    }
  }
  const reserved = new Set<string>() // ids of instances still being made (and provisioned)
  const idHeld = (iid: string) => reserved.has(iid) || [...members.keys()].some(c => parseInstance(c)?.id === iid)

  async function makePod(coord: string, impl: Implementation, config: unknown): Promise<NanoResult<Pod>> {
    if (impl.config && !impl.config.check(config)) return failure('invalid-input', `${coord}: config does not fit ${impl.config.type}`)
    const { ctx, bind } = contextFor(wiring, coord, impl, config)
    const pod = await createHostPod(coord, impl, ctx, opts.pod)
    if (pod.ok) bind(pod.value)
    return pod
  }
  const drop = (m: Member) => {
    if (m.home === id) m.pod.dispose()
    leave(m.pod, deliver)
    members.delete(m.coord)
  }

  /** Live call connections of `pending`, read as if it were already a member: what provisioning must not redo. */
  const connected = (pending: Member) => (d: SelectorData) => {
    const member = (c: string) => (c === pending.coord ? pending : members.get(c))
    const status = (sid: string) => { const s = subs.find(x => x.id === sid); return s && statusOf(s, member) }
    return connectionsOf({ ...wiring, member, status }, pending.coord, d).length > 0
  }

  /** Create, provisioning first when asked; `stack` is the implementations being made above this one. */
  async function make(iid: string, implementation: string, o: { config?: unknown; provision?: boolean }, stack: readonly string[]): Promise<NanoResult<{ coord: string; unsatisfied: Unsatisfied[] }> & { cycle?: readonly string[] }> {
    const impl = registry.implementation(implementation)
    if (!impl) return failure('not-found', `no implementation ${implementation}`)
    if (idHeld(iid) || opts.idTaken?.(iid)) return failure('exists', `instance id ${iid} is taken`)
    const coord = instanceCoord(implementation, iid)
    reserved.add(iid)
    try {
      const pod = await makePod(coord, impl, o.config)
      if (!pod.ok) return pod
      const pending: Member = { coord, pod: pod.value, home: id, ...(o.config !== undefined && { config: o.config }) }
      const isConnected = connected(pending)
      // Dependencies are made before the instance joins, so a dependency that leads back to it is a cycle, not a connection.
      const p = o.provision
        ? await provision({
          registry, target, connected: isConnected,
          members: () => [...members.keys()],
          idFree: n => !idHeld(n) && !opts.idTaken?.(n),
          make: (n, c, st) => make(n, c, { provision: true }, st),
          subscribe: s => rt.subscribe(s),
        }, coord, impl, [...stack, implementation])
        : { unsatisfied: Object.entries(impl.dependencies).filter(([, d]) => !isConnected(d)).map(([role]) => ({ role, reason: 'not provisioned' })), subscribed: [], cycles: [] }
      // A nested instance on a cycle is not made; the first instance above the cycle is made with that role unsatisfied. Another runtime may have taken the id meanwhile.
      const onCycle = stack.length > 0 ? p.cycles.find(c => c.includes(implementation)) : undefined
      const no = onCycle ? { ...failure('cycle', cycleReason(onCycle)), cycle: onCycle }
        : opts.idTaken?.(iid) ? failure('exists', `instance id ${iid} is taken`) : undefined
      if (no) {
        pod.value.dispose()
        for (const sid of p.subscribed) rt.unsubscribe(sid)
        return no // ponytail: instances made for its other roles stay as ordinary members; undo them if that bites
      }
      members.set(coord, pending)
      join(pod.value, deliver)
      emit({ type: 'instance-added', instance: coord, home: id })
      recompute()
      return success({ coord, unsatisfied: p.unsatisfied })
    } finally {
      reserved.delete(iid)
    }
  }

  const rt: Runtime = {
    id,
    registry,
    policy,
    create: (iid, implementation, o = {}) => make(iid, implementation, o, []),
    add(m) {
      const parsed = parseInstance(m.coord)
      if (!parsed) return failure('invalid-input', `bad instance coord ${m.coord}`)
      if (m.pod.instance !== m.coord) return failure('invalid-input', `${m.coord}: its pod is ${m.pod.instance}`)
      if (members.has(m.coord) || idHeld(parsed.id)) return failure('exists', `instance id ${parsed.id} is taken`)
      members.set(m.coord, m)
      join(m.pod, deliver)
      emit({ type: 'instance-added', instance: m.coord, home: m.home })
      recompute()
      return success(undefined)
    },
    remove(coord) {
      const m = members.get(coord)
      if (!m) return failure('not-found', `${coord} is not a member`)
      drop(m)
      emit({ type: 'instance-removed', instance: coord })
      recompute()
      return success(undefined)
    },
    async replace(coord, implementation, o = {}) {
      const old = members.get(coord)
      if (!old) return failure('not-found', `${coord} is not a member`)
      if (old.home !== id) return failure('denied', `${coord}: replace it at its home runtime ${old.home}`)
      const impl = registry.implementation(implementation)
      if (!impl) return failure('not-found', `no implementation ${implementation}`)
      const to = instanceCoord(implementation, parseInstance(coord)!.id)
      const swap = (c: string) => (c === coord ? to : c)
      const rewrite = () => subs.filter(s => s.from === coord || s.to === coord).map(s => ({ ...s, from: swap(s.from), to: swap(s.to) }))
      const early = denied(rewrite())
      if (early) return early
      const config = 'config' in o ? o.config : old.config
      const pod = await makePod(to, impl, config)
      if (!pod.ok) return pod
      // Subscriptions may have changed during the await: rewrite and police what is there now.
      const touched = rewrite()
      const no = members.get(coord) !== old ? failure('not-found', `${coord} changed while it was replaced`) : denied(touched)
      if (no) { pod.value.dispose(); return no }
      old.pod.dispose()
      leave(old.pod, deliver)
      join(pod.value, deliver)
      const next: Member = { coord: to, pod: pod.value, home: id, ...(config !== undefined && { config }) }
      members = new Map([...members].map(([c, m]) => (c === coord ? [to, next] : [c, m]))) // keeps the slot in create order
      subs = subs.map(s => touched.find(t => t.id === s.id) ?? s)
      emit({ type: 'instance-replaced', from: coord, to })
      for (const s of touched) emit({ type: 'subscription-set', subscription: s })
      recompute()
      return success(to)
    },
    member: c => members.get(c),
    members: () => [...members.keys()],
    target,
    subscribe(input) {
      const sid = input.id ?? nextId(subs)
      if (subs.some(s => s.id === sid)) return failure('exists', `subscription ${sid} exists`)
      const s = { ...input, id: sid } as SubscriptionData
      const no = bad(s) ?? denied([s])
      if (no) return no
      subs.push(s)
      emit({ type: 'subscription-set', subscription: s })
      recompute()
      return success(s)
    },
    unsubscribe(sid) {
      if (!subs.some(s => s.id === sid)) return failure('not-found', `no subscription ${sid}`)
      subs = subs.filter(s => s.id !== sid)
      statuses.delete(sid)
      books.delete(sid)
      emit({ type: 'subscription-removed', id: sid })
      return success(undefined)
    },
    retarget(sid, to) {
      const i = subs.findIndex(s => s.id === sid)
      if (i < 0) return failure('not-found', `no subscription ${sid}`)
      const s = { ...subs[i]!, to }
      const no = bad(s) ?? denied([s])
      if (no) return no
      subs[i] = s
      emit({ type: 'subscription-set', subscription: s })
      recompute()
      return success(undefined)
    },
    reorder(consumer, ids) {
      const next = reordered(subs, consumer, ids)
      if (!next) return failure('not-found', `${ids.join(', ')} is not exactly ${consumer}'s call subscriptions`)
      const no = denied(next.filter(s => ids.includes(s.id)))
      if (no) return no
      subs = next
      for (const sid of ids) emit({ type: 'subscription-set', subscription: subs.find(s => s.id === sid)! })
      return success(undefined)
    },
    subscriptions: () => [...subs],
    status: sid => statuses.get(sid),
    books: sid => (subs.some(s => s.id === sid) ? { ...(books.get(sid) ?? { calls: 0 }) } : undefined),
    listen(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
  return rt
}
