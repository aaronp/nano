/**
 * The runtime: pods (each owning its instances `<pod>#<n>` and their states) and their lifecycle (create first, then wire,
 * when asked to provision; add, scale, restart and swap in place; removing an instance or a pod deletes the subscriptions
 * naming it), subscriptions as data with live/waiting/broken status, policy on every rewire, books per subscription.
 *
 *   const rt = createRuntime('r1', { registry })
 *   await rt.create('b', 'acme/log/mem', { count: 2 })          // NanoResult<{ pod: 'b', instances: ['b#0', 'b#1'], unsatisfied: [] }>
 *   rt.pod('b')                                                  // { id: 'b', implementation: 'acme/log/mem', count: 2, state: 'running', home: 'r1', instances: [...] }
 *   await rt.scale('b', 3); rt.removeInstance('b#0')             // b#2 added (indices are never reused); b#0 and its subscriptions gone
 *   rt.subscribe({ kind: 'call', from: 'a#0', to: 'b#0' }); rt.status('s1')   // 'waiting': no a#0 yet
 *   rt.books('s1')                                               // { calls: 0 }
 *   rt.listen(e => console.log(e))                               // { type: 'pod-created', … }, { type: 'instance', coord: 'b#0', state: 'running' }, …
 */
import type { Implementation } from '../implementation.ts'
import { Pod } from '../pod.ts'
import { Policies, type Policy } from '../policy.ts'
import type { Registry } from '../registry.ts'
import { failure, success, type NanoResult } from '../result.ts'
import type { EndSelector, Target } from '../selector.ts'
import { connectionsOf, contextFor, deliverer, type Book, type Wiring } from './calls.ts'
import { resolveEnd } from './connect.ts'
import { provision, type Unsatisfied } from './provision.ts'
import { badIndices, ID, instanceCoord, locate, MAX_INSTANCES, MAX_PODS, MAX_SUBSCRIPTIONS, parseInstance, podInfo, targetOf, type Holder, type Instance, type PodInfo, type PodRecord } from './pods.ts'
import { isJson } from '../schema.ts'
import { invalid, nextId, reordered, statusOf, type NewSubscription, type Status, type SubscriptionData } from './subscriptions.ts'
import { tracer, type RuntimeEvent } from './trace.ts'

export * from './pods.ts'
export * from './subscriptions.ts'
export type { Book } from './calls.ts'
export type { Unsatisfied } from './provision.ts'
export type { RuntimeEvent } from './trace.ts'

/** The highest instance index a coord can carry. */
const MAX_INDEX = 999_999_999

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
  /** Scale to `count` (0 to MAX_INSTANCES): up adds at the next indices, down removes the highest. Returns the instance coords after. Only at home. */
  scale(pod: string, count: number): Promise<NanoResult<string[]>>
  /** Remove one instance (only at home): it is disposed and every subscription naming it is deleted (decision 49). */
  removeInstance(coord: string): NanoResult<void>
  /** Remake a `failed` instance in place (a removed one is gone, not stopped); a failing make returns `threw` or `timeout` and leaves it `failed`. Only at home. */
  restart(coord: string): Promise<NanoResult<void>>
  /** At home, the pod's instances are disposed and every subscription naming them is deleted, in every runtime holding it; placed here from elsewhere, only this runtime's membership (and its subscriptions to it) go. */
  remove(pod: string): NanoResult<void>
  /**
   * Swap a pod's implementation (and config, when given) in place, only at home: coords, tags and subscriptions are kept;
   * every instance is remade off to the side (one added meanwhile too), then all switch at once and every runtime holding
   * the pod recomputes its statuses (ports that no longer fit → `broken`). Until the switch the old instances serve; calls
   * already inside an old one finish there. A failing make changes nothing (each is a `failure` on the stream of every
   * runtime holding the pod); so does a swap superseded by a later one (the last asked wins; the earlier fails `invalid-input`).
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
  /**
   * The runtime's one stream, in order: lifecycle (`pod-created` when a pod is created or placed here, then each instance's
   * state; every `instance` state change, with the reason when it fails; `pod-swapped`; removal is `instance` `stopped`,
   * the cascade, then `pod-removed`), wiring, messages (`sent`, then `delivered` or `denied`) and problems (`failure`,
   * `warning`). A throwing listener is swallowed.
   *
   * Deliberately off the stream: calls a `make` makes through its own ctx (they fail at once), a message whose
   * subscription vanished while it waited for a provisioning pass (it is never sent), and verb results `missing-component`
   * and `ambiguous` (no message was sent; the caller has the fail). A listener that acts on the runtime re-enters it, so
   * the events its action emits reach later listeners before the event it is handling.
   */
  listen(fn: (e: RuntimeEvent) => void): () => void
  /** Put a warning on this runtime's stream (the application's notes, as they happen). */
  warn(reason: string): void
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
  /** Why `more` instances cannot be added across the application (its limit), or undefined. */
  full?: (more: number) => string | undefined
  pod?: { timeoutMs?: number }
}

/** Throws on an id outside the id rule (a construction error, like a bad coord). */
export function createRuntime(id: string, opts: RuntimeOpts): Runtime {
  if (!ID.test(id)) throw new Error(`bad runtime id ${JSON.stringify(id)}`)
  const { registry } = opts
  const policy = opts.policy ?? Policies.allowAll()
  const pods = new Map<string, PodRecord>() // insertion order is create order; saving relies on it
  let subs: SubscriptionData[] = []
  const statuses = new Map<string, Status>()
  const trace = tracer()
  const emit = trace.emit
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
    trace,
    settled: c => passOf.get(c) ?? opts.settling?.(c),
  }

  const recompute = (only: readonly SubscriptionData[] = subs) => {
    for (const s of only) {
      const now = statusOf(s, find, id)
      if (statuses.get(s.id) !== now) { statuses.set(s.id, now); emit({ type: 'status', id: s.id, status: now }) }
    }
  }
  const drop = (sid: string, reason: 'unsubscribed' | 'cascade') => {
    subs = subs.filter(s => s.id !== sid)
    statuses.delete(sid)
    books.delete(sid)
    emit({ type: 'subscription-removed', id: sid, reason })
  }
  /** This runtime stops holding `coords`: subscriptions naming them are deleted (they are gone, not unavailable). */
  const forget = (p: PodRecord, coords: string[], whole: boolean) => {
    if (whole) { pods.delete(p.id); p.holders.delete(holder) }
    const gone = new Set(coords)
    for (const s of subs.filter(s => gone.has(s.from) || gone.has(s.to))) drop(s.id, 'cascade')
    recompute()
    if (whole) emit({ type: 'pod-removed', pod: p.id })
  }
  const holder: Holder = { deliver: deliverer(wiring), refresh: recompute, forget, emit }
  /** A pod's instances changed: every runtime holding it recomputes its statuses. */
  const changed = (p: PodRecord) => { for (const h of p.holders) h.refresh() }
  /** News of a pod, on the stream of every runtime holding it. */
  const tell = (p: PodRecord, e: RuntimeEvent) => { for (const h of [...p.holders]) h.emit(e) }
  const stateOf = (i: Instance): RuntimeEvent => ({ type: 'instance', coord: i.coord, state: i.state, ...(i.reason !== undefined && { reason: i.reason }) })
  const hold = (p: PodRecord) => {
    pods.set(p.id, p)
    p.holders.add(holder)
    emit({ type: 'pod-created', pod: p.id, implementation: p.implementation.coord })
    for (const i of p.instances.values()) emit(stateOf(i))
    recompute()
  }
  /** Instances of this runtime's own pods. */
  const own = () => [...pods.values()].reduce((n, p) => n + (p.home === id ? p.instances.size : 0), 0)
  const tooMany = (pod: string, more: number): NanoResult<never> | undefined => {
    if (own() + more > MAX_INSTANCES) return failure('invalid-input', `${pod}: ${id} would hold more than ${MAX_INSTANCES} instances`)
    const why = more > 0 && opts.full?.(more)
    if (why) return failure('invalid-input', `${pod}: ${why}`)
  }

  const noPodRoom = (pod: string): NanoResult<never> | undefined =>
    pods.size >= MAX_PODS ? failure('invalid-input', `${pod}: ${id} would hold more than ${MAX_PODS} pods`) : undefined

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
        emit({ type: 'failure', coord: s.from, reason: why })
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
    !Number.isInteger(n) || n < min || n > MAX_INSTANCES ? failure('invalid-input', `${pod}: count must be a whole number from ${min} to ${MAX_INSTANCES}`) : undefined
  /** A host for `coord` (ponytail: a bridge until Task 2: a Pod named by the coord, its make handed the ctx): its own throw or timeout is a `failure` on the stream of every runtime holding the pod. */
  const host = (p: PodRecord, coord: string, impl: Implementation, ctx: ReturnType<typeof contextFor>['ctx']) => new Promise<NanoResult<NonNullable<Instance['host']>>>(resolve => {
    const pod = Pod.create({ ...impl, coord, make: () => impl.make(ctx) }, opts.pod)
    const invoke = (port: string, input: unknown) => pod.invoke(ctx, port, input).then(r => { if (!r.ok && /^(threw|timeout)$/.test(r.fail.type) && r.fail.reason.startsWith(`${coord}: `)) tell(p, { type: 'failure', coord, reason: r.fail.reason }); return r })
    pod.join(id, (s, why = '') => resolve(s === 'running' ? success({ implementation: impl, invoke, dispose: () => void pod.dispose() }) : failure('threw', why)))
  })
  /** Make one instance's host; failing, the instance is `failed` with the reason. Stopped meanwhile (removed), the host is dropped. */
  async function start(p: PodRecord, inst: Instance): Promise<NanoResult<void>> {
    const { ctx, bind } = contextFor(wiring, inst.coord, p.implementation)
    const made = await host(p, inst.coord, p.implementation, ctx)
    if (inst.state !== 'starting') {
      if (made.ok) made.value.dispose()
      return failure('not-found', p.instances.get(inst.coord) === inst ? `${inst.coord} was replaced (swapped) while it started` : `${inst.coord} was removed while it started`)
    }
    if (made.ok) { bind(made.value); inst.host = made.value; inst.state = 'running'; delete inst.reason } else {
      inst.state = 'failed'; inst.reason = made.fail.reason
    }
    tell(p, stateOf(inst))
    changed(p)
    return made.ok ? success(undefined) : made
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
    if (restore && o.count !== undefined) return failure('invalid-input', `${pid}: give count, or instances and next, not both`)
    const bc = restore ? undefined : badCount(pid, o.count ?? 1)
    if (bc) return bc
    // Restored in index order, however they were saved.
    const indices = o.instances ? [...o.instances].sort((a, b) => a - b) : Array.from({ length: o.count ?? 1 }, (_, n) => n)
    const next = o.next ?? indices.reduce((m, n) => Math.max(m, n + 1), 0)
    const why = restore && badIndices(indices, next)
    if (why) return failure('invalid-input', `${pid}: ${why}`)
    const full = tooMany(pid, indices.length) ?? noPodRoom(pid)
    if (full) return full
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
      // Read now, not before the makes: a swap meanwhile changed what runs, and so what it depends on.
      if (!o.provision) return success({ pod: pid, instances: coords, unsatisfied: coords.flatMap(c => notProvisioned(c, p.implementation)) })
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
      }, c, p.implementation))
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
      const full = tooMany(pid, 1)
      if (full) return full
      if (p.next > MAX_INDEX) return failure('invalid-input', `${pid}: no instance index is left (the last is ${MAX_INDEX})`)
      const inst: Instance = { coord: instanceCoord(pid, p.next++), state: 'starting' }
      p.instances.set(inst.coord, inst)
      tell(p, stateOf(inst))
      changed(p)
      await start(p, inst) // a failed make leaves it `failed`, as on create
      return p.instances.get(inst.coord) === inst ? success(inst.coord) : failure('not-found', `${inst.coord} was removed while it started`)
    },
    async scale(pid, count) {
      const p = pods.get(pid)
      if (!p) return failure('not-found', `${pid} is not a pod of ${id}`)
      if (p.home !== id) return failure('denied', `${pid}: scale it at its home runtime ${p.home}`)
      const more = count - p.instances.size
      const no = badCount(pid, count, 0) ?? tooMany(pid, more)
      if (no) return no
      if (p.next + more - 1 > MAX_INDEX) return failure('invalid-input', `${pid}: no instance index is left (the last is ${MAX_INDEX})`)
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
      tell(f.pod, stateOf(f.instance))
      for (const h of [...f.pod.holders]) h.forget(f.pod, [coord], false)
      return success(undefined)
    },
    async restart(coord) {
      const f = find(coord)
      if (!f) return failure('not-found', `${coord} is not an instance of ${id}`)
      if (f.pod.home !== id) return failure('denied', `${coord}: restart it at its home runtime ${f.pod.home}`)
      if (f.instance.state !== 'failed') return failure('invalid-input', `${coord} is ${f.instance.state}`)
      delete f.instance.reason
      f.instance.state = 'starting'
      tell(f.pod, stateOf(f.instance))
      changed(f.pod)
      return start(f.pod, f.instance)
    },
    add(p) {
      if (pods.has(p.id)) return failure('exists', `pod id ${p.id} is taken`)
      const full = noPodRoom(p.id)
      if (full) return full
      hold(p)
      return success(undefined)
    },
    remove(pid) {
      const p = pods.get(pid)
      if (!p) return failure('not-found', `${pid} is not a pod of ${id}`)
      const coords = [...p.instances.keys()]
      if (p.home !== id) { forget(p, coords, true); return success(undefined) }
      const stopped = [...p.instances.values()]
      for (const i of stopped) { i.host?.dispose(); delete i.host; i.state = 'stopped' }
      p.instances.clear()
      for (const i of stopped) tell(p, stateOf(i))
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
      const made = new Map<string, { bind: ReturnType<typeof contextFor>['bind']; host: Awaited<ReturnType<typeof host>> }>()
      for (let todo = [...p.instances.keys()]; todo.length > 0; todo = [...p.instances.keys()].filter(c => !made.has(c)))
        await Promise.all(todo.map(async coord => {
          const { ctx, bind } = contextFor(wiring, coord, impl)
          made.set(coord, { bind, host: await host(p, coord, impl, ctx) })
        }))
      const fail = swaps.get(p) !== gen ? failure('invalid-input', `${pid}: superseded by a later swap`)
        : [...made.values()].flatMap(m => (m.host.ok ? [] : [m.host]))[0] ?? (pods.get(pid) !== p ? failure('not-found', `${pid} was removed while it was swapped`) : undefined)
      if (fail) {
        for (const [coord, m] of made) if (m.host.ok) m.host.value.dispose(); else tell(p, { type: 'failure', coord, reason: m.host.fail.reason })
        return fail
      }
      const from = p.implementation.coord
      p.implementation = impl
      if (config === undefined) delete p.config
      else p.config = config
      const revived: Instance[] = []
      for (const [coord, m] of made) {
        if (!m.host.ok) continue // never: any failure returned above
        const inst = p.instances.get(coord)
        if (!inst) { m.host.value.dispose(); continue } // removed meanwhile
        // Disposing only refuses new calls: calls already inside the old host finish there.
        inst.host?.dispose()
        m.bind(m.host.value)
        inst.host = m.host.value
        if (inst.state !== 'running') revived.push(inst)
        inst.state = 'running'
        delete inst.reason
      }
      tell(p, { type: 'pod-swapped', pod: pid, from, to: implementation })
      for (const i of revived) tell(p, stateOf(i))
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
      if (subs.length >= MAX_SUBSCRIPTIONS) return failure('invalid-input', `${id} would hold more than ${MAX_SUBSCRIPTIONS} subscriptions`)
      const s = { ...input, id: sid } as SubscriptionData
      const no = bad(s) ?? denied([s])
      if (no) return no
      subs.push(s)
      emit({ type: 'subscription-set', subscription: s })
      recompute([s]) // a new subscription changes no other's status
      return success(s)
    },
    unsubscribe(sid) {
      if (!subs.some(s => s.id === sid)) return failure('not-found', `no subscription ${sid}`)
      drop(sid, 'unsubscribed')
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
    listen: trace.listen,
    warn: reason => emit({ type: 'warning', reason }),
    settling: c => passOf.get(c),
  }
  return rt
}
