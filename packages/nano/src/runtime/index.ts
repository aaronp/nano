/**
 * The runtime: pods (each owning its instances `<pod>#<n>` and their states) and their lifecycle (create first, then wire,
 * when asked to provision), subscriptions as data with live/waiting/broken status, policy on every rewire, books per subscription.
 *
 *   const rt = createRuntime('r1', { registry })
 *   await rt.create('b', 'acme/log/mem', { count: 2 })          // NanoResult<{ pod: 'b', instances: ['b#0', 'b#1'], unsatisfied: [] }>
 *   rt.pod('b')                                                  // { id: 'b', implementation: 'acme/log/mem', count: 2, state: 'running', home: 'r1', instances: [...] }
 *   rt.subscribe({ kind: 'call', from: 'a#0', to: 'b#0' }); rt.status('s1')   // 'waiting': no a#0 yet
 *   rt.books('s1')                                               // { calls: 0 }
 */
import type { Implementation } from '../implementation.ts'
import { createHostPod, type Observation, type Pod } from '../pod.ts'
import { Policies, type Policy } from '../policy.ts'
import type { Registry } from '../registry.ts'
import { failure, success, type NanoResult } from '../result.ts'
import type { EndSelector, Target } from '../selector.ts'
import { connectionsOf, contextFor, deliverer, type Book, type Wiring } from './calls.ts'
import { resolveEnd } from './connect.ts'
import { provision, type Unsatisfied } from './provision.ts'
import { badIndices, ID, instanceCoord, locate, parseInstance, podInfo, targetOf, type Holder, type Instance, type PodInfo, type PodRecord } from './pods.ts'
import { isJson } from '../schema.ts'
import { invalid, nextId, reordered, statusOf, type NewSubscription, type Status, type SubscriptionData } from './subscriptions.ts'

export * from './pods.ts'
export * from './subscriptions.ts'
export type { Book } from './calls.ts'
export type { Unsatisfied } from './provision.ts'

export type RuntimeEvent =
  | { type: 'instance-added'; instance: string; home: string }
  | { type: 'instance-removed'; instance: string }
  | { type: 'pod-swapped'; pod: string; implementation: string }
  | { type: 'subscription-set'; subscription: SubscriptionData }
  | { type: 'subscription-removed'; id: string }
  | { type: 'status'; id: string; status: Status }

export type NewConnection =
  | { id?: string; kind: 'call'; from: EndSelector; to: EndSelector }
  | { id?: string; kind: 'event'; from: EndSelector; source: string; to: EndSelector; target: string }

export type CreateOpts = { config?: unknown; count?: number; provision?: boolean; instances?: readonly number[]; next?: number }

export type Created = { pod: string; instances: string[]; unsatisfied: Unsatisfied[] }

export type Runtime = {
  readonly id: string
  readonly registry: Registry
  readonly policy: Policy
  /**
   * A pod of `count` instances (default 1), `<pod>#0` up. A `make` that throws or times out leaves that instance `failed`;
   * the create still succeeds. With `provision: true`, connects or makes what each instance's dependencies need;
   * `unsatisfied` lists the rest (`not provisioned` without it). `instances` and `next` restore a saved pod exactly
   * (its live indices, perhaps none, and its next index) in place of `count`.
   */
  create(pod: string, implementation: string, opts?: CreateOpts): Promise<NanoResult<Created>>
  /** One more instance at the next index (indices are never reused); only at the pod's home. */
  addInstance(pod: string): Promise<NanoResult<string>>
  /** Place a pod from its home: the record is shared, not copied, so its instances and their states are the home's. */
  add(pod: PodRecord): NanoResult<void>
  /** Scale to `count` (1 to 500): up adds at the next indices, down removes the highest. Returns the instance coords after. Only at home. */
  scale(pod: string, count: number): Promise<NanoResult<string[]>>
  /** Remove one instance (only at home): it is disposed and every subscription naming it is deleted (decision 49). */
  removeInstance(coord: string): NanoResult<void>
  /** Remake an instance in place; a failing make returns `threw` and leaves it `failed`. Only at home. */
  restart(coord: string): Promise<NanoResult<void>>
  /** At home, the pod's instances are disposed and every subscription naming them is deleted, in every runtime holding it; placed here from elsewhere, only this runtime's membership (and its subscriptions to it) go. */
  remove(pod: string): NanoResult<void>
  /**
   * Swap a pod's implementation (and config, when given) in place, only at home: coords, tags and subscriptions are kept;
   * every instance is remade off to the side (one added meanwhile too), then all switch at once and every runtime holding
   * the pod recomputes its statuses (ports that no longer fit → `broken`). Until the switch the old instances serve; calls
   * already inside an old one finish there. A failing make changes nothing; so does a swap superseded by a later one
   * (the last asked wins; the earlier fails `invalid-input`).
   */
  swap(pod: string, implementation: string, opts?: { config?: unknown }): Promise<NanoResult<void>>
  pod(id: string): PodInfo | undefined
  /** Pod ids, in create (or place) order. */
  pods(): readonly string[]
  /** Every instance coord, by pod, in index order. */
  instances(): readonly string[]
  /** The live pod record, for placing it into another runtime. */
  record(id: string): PodRecord | undefined
  target(coord: string): Target | undefined
  /** Resolve both ends to concrete instance coords, once, and subscribe them. */
  connect(c: NewConnection): NanoResult<SubscriptionData>
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
  /** A pod id held elsewhere (in the application). */
  idTaken?: (id: string) => boolean
  /** Unfinished passes elsewhere (the pod's home runtime): calls here into or out of `coord` wait for them too. */
  settling?: (coord: string) => Promise<void> | undefined
  pod?: { timeoutMs?: number; observe?(o: Observation): void }
}

/** Throws on an id outside the id rule (a construction error, like a bad coord). */
export function createRuntime(id: string, opts: RuntimeOpts): Runtime {
  if (!ID.test(id)) throw new Error(`bad runtime id ${JSON.stringify(id)}`)
  const { registry } = opts
  const policy = opts.policy ?? Policies.allowAll()
  const pods = new Map<string, PodRecord>() // insertion order is create order; saving relies on it
  let subs: SubscriptionData[] = []
  const statuses = new Map<string, Status>()
  const listeners = new Set<(e: RuntimeEvent) => void>()
  const books = new Map<string, Book>()
  const find = (coord: string) => locate(pods, coord)
  const target = (coord: string): Target | undefined => {
    const f = find(coord)
    return f && targetOf(coord, f.pod.implementation, opts.tagsOf?.(coord) ?? new Set())
  }
  const instances = () => [...pods.values()].flatMap(p => [...p.instances.keys()])
  const wiring: Wiring = {
    id, policy, books, target,
    subscriptions: () => subs,
    status: sid => statuses.get(sid),
    locate: find,
    observe: o => opts.pod?.observe?.(o),
    settled: c => passOf.get(c) ?? opts.settling?.(c),
  }

  const emit = (e: RuntimeEvent) => {
    for (const fn of listeners) try { fn(e) } catch { /* a listener must never break the runtime */ }
  }
  const recompute = () => {
    for (const s of subs) {
      const now = statusOf(s, find, id)
      if (statuses.get(s.id) !== now) { statuses.set(s.id, now); emit({ type: 'status', id: s.id, status: now }) }
    }
  }
  /** This runtime stops holding `coords`: subscriptions naming them are deleted (they are gone, not unavailable). */
  const forget = (p: PodRecord, coords: string[], whole: boolean) => {
    if (whole) { pods.delete(p.id); p.holders.delete(holder) }
    const gone = new Set(coords)
    for (const c of coords) emit({ type: 'instance-removed', instance: c })
    for (const s of subs.filter(s => gone.has(s.from) || gone.has(s.to))) rt.unsubscribe(s.id)
    recompute()
  }
  const holder: Holder = { deliver: deliverer(wiring), refresh: recompute, forget, added: (p, c) => emit({ type: 'instance-added', instance: c, home: p.home }) }
  /** A pod's instances changed: every runtime holding it recomputes its statuses. */
  const changed = (p: PodRecord) => { for (const h of p.holders) h.refresh() }
  const hold = (p: PodRecord) => {
    pods.set(p.id, p)
    p.holders.add(holder)
    for (const c of p.instances.keys()) emit({ type: 'instance-added', instance: c, home: p.home })
    recompute()
  }

  const bad = (s: SubscriptionData): NanoResult<never> | undefined => {
    const why = invalid(s)
    if (why) return failure('invalid-input', why)
    // A coord of a pod here, below its `next`, yet missing, was deleted (indices are never reused); anything else may yet come.
    for (const c of [s.from, s.to]) {
      const l = parseInstance(c), p = l && pods.get(l.pod)
      if (p && l.index < p.next && !p.instances.has(c)) return failure('not-found', `${c} was removed`)
    }
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
  const badConfig = (pod: string, impl: Implementation, config: unknown): NanoResult<never> | undefined => {
    if (config !== undefined && !isJson(config)) return failure('invalid-input', `${pod}: config is not JSON`)
    if (impl.config && !impl.config.check(config)) return failure('invalid-input', `${pod}: config does not fit ${impl.config.type}`)
  }

  const badCount = (pod: string, n: number, min = 1): NanoResult<never> | undefined =>
    !Number.isInteger(n) || n < min || n > 500 ? failure('invalid-input', `${pod}: count must be a whole number from ${min} to 500`) : undefined
  /** Make one instance's host; failing, the instance is `failed` with the reason. Stopped meanwhile (removed), the host is dropped. */
  async function start(p: PodRecord, inst: Instance): Promise<NanoResult<void>> {
    const { ctx, bind } = contextFor(wiring, inst.coord, p.implementation, p.config)
    const host = await createHostPod(inst.coord, p.implementation, ctx, opts.pod)
    if (inst.state !== 'starting') {
      if (host.ok) host.value.dispose()
      return failure('not-found', p.instances.get(inst.coord) === inst ? `${inst.coord} was replaced (swapped) while it started` : `${inst.coord} was removed while it started`)
    }
    if (host.ok) { bind(host.value); inst.host = host.value; inst.state = 'running'; delete inst.reason } else {
      inst.state = 'failed'; inst.reason = host.fail.reason
      try { opts.pod?.observe?.({ kind: 'exception', instance: inst.coord, op: 'make', error: host.fail.reason }) } catch { /* an observer must never break the runtime */ }
    }
    changed(p)
    return host.ok ? success(undefined) : host
  }

  /** coord → the provisioning pass it was made in, while that pass is unfinished; calls into or out of it wait for it. */
  const passOf = new Map<string, Promise<void>>()
  type Pass = { done: Promise<void>; coords: string[] }
  const notProvisioned = (coord: string, impl: Implementation) =>
    Object.entries(impl.dependencies).filter(([, d]) => connectionsOf(wiring, coord, d).length === 0).map(([role]) => ({ role, reason: 'not provisioned' }))

  /**
   * Create; the pod is held (its id taken, its instances `starting`) before anything is awaited. With `provision`, one
   * pass: every pod it makes joins at once, then its instances' dependencies are settled (made pods settle theirs in the
   * same pass). Calls into or out of the pass's instances wait until it is done. Calls a `make` makes through its own ctx
   * fail at once (construction is not use), so a make cannot wait on its own pass.
   */
  async function make(pid: string, implementation: string, o: CreateOpts, pass?: Pass, depth = 0): Promise<NanoResult<Created>> {
    if (!ID.test(pid)) return failure('invalid-input', `bad pod id ${JSON.stringify(pid)}`)
    const restore = o.instances !== undefined || o.next !== undefined
    const bc = restore ? undefined : badCount(pid, o.count ?? 1)
    if (bc) return bc
    const indices = o.instances ?? Array.from({ length: o.count ?? 1 }, (_, n) => n)
    const next = o.next ?? indices.reduce((m, n) => Math.max(m, n + 1), 0)
    const why = restore && badIndices(indices, next)
    if (why) return failure('invalid-input', `${pid}: ${why}`)
    const impl = registry.implementation(implementation)
    if (!impl) return failure('not-found', `no implementation ${implementation}`)
    if (pods.has(pid) || opts.idTaken?.(pid)) return failure('exists', `pod id ${pid} is taken`)
    const no = badConfig(pid, impl, o.config)
    if (no) return no
    const coords = indices.map(n => instanceCoord(pid, n))
    const p: PodRecord = {
      id: pid, implementation: impl, ...(o.config !== undefined && { config: o.config }), home: id, next,
      instances: new Map(coords.map(c => [c, { coord: c, state: 'starting' }])), holders: new Set(),
    }
    let release: (() => void) | undefined
    if (o.provision && !pass) {
      let r!: () => void
      pass = { done: new Promise<void>(res => { r = res }), coords: [] }
      release = r
    }
    if (pass) for (const c of coords) { pass.coords.push(c); passOf.set(c, pass.done) }
    hold(p)
    try {
      await Promise.all([...p.instances.values()].map(i => start(p, i)))
      const gone = () => pods.get(pid) !== p // removed (or its id remade) meanwhile: nothing more is made or wired for it
      if (gone()) return failure('not-found', `${pid} was removed while it was made`)
      if (!o.provision) return success({ pod: pid, instances: coords, unsatisfied: coords.flatMap(c => notProvisioned(c, impl)) })
      // ponytail: the manifest per make; a registry count if provisioning gets hot. The limit should be unreachable:
      // a pod is only made when no instance matches, and once made it matches, so a pass makes each implementation once.
      const tooDeep = depth >= registry.manifest().implementations.length
      const unsatisfied: Unsatisfied[] = []
      for (const c of coords) if (!gone() && p.instances.has(c)) unsatisfied.push(...await provision({
        registry, target, tooDeep, instances,
        connected: d => connectionsOf(wiring, c, d).length > 0,
        idFree: n => !pods.has(n) && !opts.idTaken?.(n),
        make: (n, ic) => (gone() ? Promise.resolve(failure('not-found', `${pid} was removed`)) : make(n, ic, { provision: true }, pass, depth + 1)),
        subscribe: s => (gone() || !p.instances.has(c) || !find(s.to) ? failure('not-found', `${c} or ${s.to} was removed`) : rt.subscribe(s)),
        status: sid => statuses.get(sid),
      }, c, impl))
      return success({ pod: pid, instances: coords, unsatisfied })
    } finally {
      if (release) { for (const c of pass!.coords) passOf.delete(c); release() }
    }
  }

  const swaps = new WeakMap<PodRecord, number>() // per pod, the latest swap asked for
  const ends = { pods, tagsOf: (c: string) => opts.tagsOf?.(c) ?? new Set<string>() }
  const rt: Runtime = {
    id,
    registry,
    policy,
    create: (pid, implementation, o = {}) => make(pid, implementation, o),
    async addInstance(pid) {
      const p = pods.get(pid)
      if (!p) return failure('not-found', `${pid} is not a pod of ${id}`)
      if (p.home !== id) return failure('denied', `${pid}: add instances at its home runtime ${p.home}`)
      const inst: Instance = { coord: instanceCoord(pid, p.next++), state: 'starting' }
      p.instances.set(inst.coord, inst)
      for (const h of [...p.holders]) h.added(p, inst.coord)
      changed(p)
      await start(p, inst)
      return success(inst.coord)
    },
    async scale(pid, count) {
      const p = pods.get(pid)
      if (!p) return failure('not-found', `${pid} is not a pod of ${id}`)
      if (p.home !== id) return failure('denied', `${pid}: scale it at its home runtime ${p.home}`)
      const no = badCount(pid, count, 0)
      if (no) return no
      const byIndex = () => [...p.instances.keys()].sort((x, y) => parseInstance(x)!.index - parseInstance(y)!.index)
      for (const c of byIndex().slice(count)) rt.removeInstance(c)
      await Promise.all(Array.from({ length: count - p.instances.size }, () => rt.addInstance(pid)))
      return success(byIndex())
    },
    removeInstance(coord) {
      const f = find(coord)
      if (!f) return failure('not-found', `${coord} is not an instance of ${id}`)
      if (f.pod.home !== id) return failure('denied', `${coord}: remove it at its home runtime ${f.pod.home}`)
      f.instance.host?.dispose(); delete f.instance.host; f.instance.state = 'stopped'
      f.pod.instances.delete(coord)
      for (const h of [...f.pod.holders]) h.forget(f.pod, [coord], false)
      return success(undefined)
    },
    async restart(coord) {
      const f = find(coord)
      if (!f) return failure('not-found', `${coord} is not an instance of ${id}`)
      if (f.pod.home !== id) return failure('denied', `${coord}: restart it at its home runtime ${f.pod.home}`)
      if (f.instance.state !== 'failed' && f.instance.state !== 'stopped') return failure('invalid-input', `${coord} is ${f.instance.state}`)
      delete f.instance.reason
      f.instance.state = 'starting'
      changed(f.pod)
      return start(f.pod, f.instance)
    },
    add(p) {
      if (pods.has(p.id)) return failure('exists', `pod id ${p.id} is taken`)
      hold(p)
      return success(undefined)
    },
    remove(pid) {
      const p = pods.get(pid)
      if (!p) return failure('not-found', `${pid} is not a pod of ${id}`)
      const coords = [...p.instances.keys()]
      if (p.home !== id) { forget(p, coords, true); return success(undefined) }
      for (const i of p.instances.values()) { i.host?.dispose(); delete i.host; i.state = 'stopped' }
      p.instances.clear()
      for (const h of [...p.holders]) h.forget(p, coords, true)
      return success(undefined)
    },
    async swap(pid, implementation, o = {}) {
      const p = pods.get(pid)
      if (!p) return failure('not-found', `${pid} is not a pod of ${id}`)
      if (p.home !== id) return failure('denied', `${pid}: swap it at its home runtime ${p.home}`)
      const impl = registry.implementation(implementation)
      if (!impl) return failure('not-found', `no implementation ${implementation}`)
      const config = 'config' in o ? o.config : p.config
      const no = badConfig(pid, impl, config)
      if (no) return no
      const gen = (swaps.get(p) ?? 0) + 1 // the last swap asked for wins
      swaps.set(p, gen)
      // Every instance is remade off to the side, including any added meanwhile; the old ones serve until all are made.
      const made = new Map<string, { bind(pod: Pod): void; host: NanoResult<Pod> }>()
      for (let todo = [...p.instances.keys()]; todo.length > 0; todo = [...p.instances.keys()].filter(c => !made.has(c)))
        await Promise.all(todo.map(async coord => {
          const { ctx, bind } = contextFor(wiring, coord, impl, config)
          made.set(coord, { bind, host: await createHostPod(coord, impl, ctx, opts.pod) })
        }))
      const fail = swaps.get(p) !== gen ? failure('invalid-input', `${pid}: superseded by a later swap`)
        : [...made.values()].flatMap(m => (m.host.ok ? [] : [m.host]))[0] ?? (pods.get(pid) !== p ? failure('not-found', `${pid} was removed while it was swapped`) : undefined)
      if (fail) { for (const m of made.values()) if (m.host.ok) m.host.value.dispose(); return fail }
      p.implementation = impl
      if (config === undefined) delete p.config
      else p.config = config
      for (const [coord, m] of made) {
        if (!m.host.ok) continue // never: any failure returned above
        const inst = p.instances.get(coord)
        if (!inst) { m.host.value.dispose(); continue } // removed meanwhile
        // Disposing only refuses new calls: calls already inside the old host finish there.
        inst.host?.dispose()
        m.bind(m.host.value)
        inst.host = m.host.value
        inst.state = 'running'
        delete inst.reason
      }
      emit({ type: 'pod-swapped', pod: pid, implementation })
      changed(p)
      return success(undefined)
    },
    pod: pid => { const p = pods.get(pid); return p && podInfo(p) },
    pods: () => [...pods.keys()],
    instances,
    record: pid => pods.get(pid),
    target,
    connect(c) {
      const from = resolveEnd(ends, c.from)
      if (!from.ok) return from
      const to = resolveEnd(ends, c.to)
      if (!to.ok) return to
      return rt.subscribe({ ...c, from: from.value, to: to.value })
    },
    subscribe(input) {
      const sid = input.id ?? nextId(subs)
      if (!ID.test(sid)) return failure('invalid-input', `bad subscription id ${JSON.stringify(sid)}`)
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
