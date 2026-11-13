/**
 * The runtime: members and their lifecycle (create first, then wire, when asked to provision), subscriptions as data with live/waiting/broken status, policy on every rewire, books per subscription.
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
import type { Target } from '../selector.ts'
import { connectionsOf, contextFor, deliverer, join, leave, type Book, type Wiring } from './calls.ts'
import { provision, type Unsatisfied } from './provision.ts'
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
  /**
   * A placed member was replaced at its home: `to` takes `from`'s slot, and subscriptions are rewritten from → to under this
   * runtime's policy. Denied, the member is still swapped but the subscriptions stay on `from` (waiting) and the denial comes back.
   */
  rehome(from: string, to: Member): NanoResult<void>
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
  /** While `coord` is in this runtime's own unfinished provisioning pass, the pass's end. */
  settling(coord: string): Promise<void> | undefined
}

export type RuntimeOpts = {
  registry: Registry
  policy?: Policy
  tagsOf?: (coord: string) => ReadonlySet<string>
  idTaken?: (id: string) => boolean
  /** Unfinished passes elsewhere (the member's home runtime): calls here into or out of `coord` wait for them too. */
  settling?: (coord: string) => Promise<void> | undefined
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
    settled: c => passOf.get(c) ?? opts.settling?.(c),
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

  /** Subscriptions touching `from`, with that end changed to `to` (not yet applied). */
  const rewritten = (from: string, to: string) => {
    const end = (c: string) => (c === from ? to : c)
    return subs.filter(s => s.from === from || s.to === from).map(s => ({ ...s, from: end(s.from), to: end(s.to) }))
  }
  /** `next` takes `old`'s slot (create order holds), publish delivery moves to its pod, `touched` subscriptions are applied. */
  const swap = (old: Member, next: Member, touched: SubscriptionData[]) => {
    leave(old.pod, deliver)
    join(next.pod, deliver)
    members = new Map([...members].map(([c, m]) => (c === old.coord ? [next.coord, next] : [c, m])))
    subs = subs.map(s => touched.find(t => t.id === s.id) ?? s)
    emit({ type: 'instance-replaced', from: old.coord, to: next.coord })
    for (const s of touched) emit({ type: 'subscription-set', subscription: s })
    recompute()
  }

  /** coord → the provisioning pass it was made in, while that pass is unfinished; calls into or out of it wait for it. */
  const passOf = new Map<string, Promise<void>>()
  type Pass = { done: Promise<void>; coords: string[] }
  const notProvisioned = (coord: string, impl: Implementation) =>
    Object.entries(impl.dependencies).filter(([, d]) => connectionsOf(wiring, coord, d).length === 0).map(([role]) => ({ role, reason: 'not provisioned' }))

  /**
   * Create; with `provision`, one pass: every instance it makes joins at once, then its dependencies are settled
   * (made instances settle theirs in the same pass). Calls into or out of the pass's instances wait until it is done.
   * Calls a `make` makes through its own ctx fail at once (construction is not use), so a make cannot wait on its own pass.
   */
  async function make(iid: string, implementation: string, o: { config?: unknown; provision?: boolean }, pass?: Pass, depth = 0): Promise<NanoResult<{ coord: string; unsatisfied: Unsatisfied[] }>> {
    const impl = registry.implementation(implementation)
    if (!impl) return failure('not-found', `no implementation ${implementation}`)
    if (idHeld(iid) || opts.idTaken?.(iid)) return failure('exists', `instance id ${iid} is taken`)
    const coord = instanceCoord(implementation, iid)
    let release: (() => void) | undefined
    if (o.provision && !pass) {
      let r!: () => void
      pass = { done: new Promise<void>(res => { r = res }), coords: [] }
      release = r
    }
    if (pass) { pass.coords.push(coord); passOf.set(coord, pass.done) }
    reserved.add(iid)
    try {
      const pod = await makePod(coord, impl, o.config)
      if (!pod.ok) return pod
      // Another runtime may have taken the id during the await.
      if (opts.idTaken?.(iid)) { pod.value.dispose(); return failure('exists', `instance id ${iid} is taken`) }
      members.set(coord, { coord, pod: pod.value, home: id, ...(o.config !== undefined && { config: o.config }) })
      join(pod.value, deliver)
      emit({ type: 'instance-added', instance: coord, home: id })
      recompute()
      if (!o.provision) return success({ coord, unsatisfied: notProvisioned(coord, impl) })
      // ponytail: the manifest per make; a registry count if provisioning gets hot. The limit should be unreachable:
      // an instance is only made when no member matches, and once made it matches, so a pass makes each implementation once.
      const tooDeep = depth >= registry.manifest().implementations.length
      const unsatisfied = await provision({
        registry, target, tooDeep,
        members: () => [...members.keys()],
        connected: d => connectionsOf(wiring, coord, d).length > 0,
        idFree: n => !idHeld(n) && !opts.idTaken?.(n),
        make: (n, c) => make(n, c, { provision: true }, pass, depth + 1),
        subscribe: s => rt.subscribe(s),
      }, coord, impl)
      return success({ coord, unsatisfied })
    } finally {
      reserved.delete(iid)
      if (release) { for (const c of pass!.coords) passOf.delete(c); release() }
    }
  }

  const rt: Runtime = {
    id,
    registry,
    policy,
    create: (iid, implementation, o = {}) => make(iid, implementation, o),
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
      const rewrite = () => rewritten(coord, to)
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
      swap(old, { coord: to, pod: pod.value, home: id, ...(config !== undefined && { config }) }, touched)
      return success(to)
    },
    rehome(from, next) {
      const old = members.get(from)
      if (!old) return failure('not-found', `${from} is not a member`)
      if (old.home === id) return failure('denied', `${from}: its home is this runtime; replace it`)
      if (next.pod.instance !== next.coord || !parseInstance(next.coord)) return failure('invalid-input', `bad member ${next.coord}`)
      if (members.has(next.coord)) return failure('exists', `${next.coord} is already a member`)
      const touched = rewritten(from, next.coord)
      const no = denied(touched)
      swap(old, next, no ? [] : touched)
      return no ?? success(undefined)
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
    settling: c => passOf.get(c),
  }
  return rt
}
