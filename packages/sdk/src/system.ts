/**
 * A System: a registry of component instances plus a synchronous bus between them. Instances are created by their
 * owner and registered; the same instance may be registered in several Systems (a bridge), and a System holds no
 * global state, so sandboxes and systems-of-systems are just more Systems.
 *
 * Registering hands the instance a handle (`onAddedToSystem`) and tells the others (`onSystemUpdated`: added, and
 * `manifest` when a component type appears). Unregistering mirrors it; it never disposes (the owner does).
 *
 * The bus: notifications and action outcomes are delivered synchronously in subscription order, nested ones FIFO
 * (after kerits' EventBus). Every operation passes `admit`: a budget of operations per correlation, and a backstop
 * per burst (until the event loop is idle), so a runaway loop is cut off and reported.
 */
import Value from 'typebox/value'
import { handle, type Core } from './handle'
import { typeHash } from './typehash'
import {
  fail, ok, routeProblem,
  type Called, type Component, type Instance, type InstanceId, type Manifest, type Notified, type Op, type Result,
  type Subscribed, type System, type SystemDelta, type SystemError, type SystemInstance,
} from './types'

/** One observed operation. `drop` means it was refused (a loop); `reason` says why. */
export type Trace = {
  kind: 'notify' | 'call' | 'deliver' | 'drop'
  correlation: string; from: InstanceId; to?: InstanceId; op: string; data?: unknown; reason?: string; at: number
}
export type ErrorInfo = { from: InstanceId; op: string; correlation: string }
/** A link: `from`'s output (a notification, or an action's outcome) feeds `to`'s op. */
export type Link = { from: InstanceId; output: string; to: InstanceId; op: string }
/** A binding: `from`'s dependency `dependency` is served by `to`'s op. */
export type Binding = { from: InstanceId; dependency: string; to: InstanceId; op: string }

export type SystemRuntime = {
  readonly id: string
  /** The System's data now: instances, and the manifest of each component type present. */
  snapshot(): System
  /** Register an existing instance under `id`; returns its handle in this System (the registrant may act as it). */
  register(id: InstanceId, component: Component, opts?: { wrap?: (h: SystemInstance) => SystemInstance }): SystemInstance
  unregister(id: InstanceId): void
  component(id: InstanceId): Component | undefined
  /** Feed `from`'s output into `to`'s op; throws if either side doesn't fit. Returns the disconnect function. */
  connect(from: InstanceId, output: Op, to: InstanceId, op: Op): () => void
  links(): Link[]
  /** Serve `from`'s dependency with `to`'s op (which must have the dependency's shape). Returns unbind. */
  bind(from: InstanceId, dependency: string, to: InstanceId, op: Op): () => void
  bindings(): Binding[]
  observe(fn: (t: Trace) => void): () => void
  /** The deltas registered components get, for the System's owner (e.g. a System component registered elsewhere). */
  updates(fn: (delta: SystemDelta) => void): () => void
}

type Entry = { instance: Instance; component: Component; base: SystemInstance }
type Sub = Subscribed & { owner: InstanceId }
const shape = (o: Op) => `${o.input ? typeHash(o.input) : '-'}>${o.output ? typeHash(o.output) : '-'}`
const quiet = (f: () => void) => { try { f() } catch {} }
let systems = 0

function create(opts: { id?: string; budget?: number; burst?: number; onError?: (e: SystemError, info: ErrorInfo) => void } = {}): SystemRuntime {
  const id = opts.id ?? `system-${++systems}`
  const entries = new Map<InstanceId, Entry>()
  const subs = new Set<Sub>(), observers = new Set<(t: Trace) => void>(), watchers = new Set<(d: SystemDelta) => void>()
  const links = new Map<Link, () => void>(), bindings = new Map<string, Binding>()
  const budget = opts.budget ?? 1000, burstMax = opts.burst ?? 100_000
  const prefix = `${id}-${Math.random().toString(36).slice(2, 6)}`
  let seq = 0, burst = 0
  const fresh = () => `${prefix}-${++seq}`
  const report = (e: SystemError, info: ErrorInfo) => quiet(() => opts.onError?.(e, info))
  const instances = (): Instance[] => [...entries.values()].map(e => e.instance)
  const manifests = (): Manifest[] => {
    const by = new Map<string, Manifest>()
    for (const e of entries.values()) by.set(`${e.instance.manifest.id.author}/${e.instance.manifest.id.id}`, e.instance.manifest)
    return [...by.values()]
  }
  const snapshot = (): System => ({ id, manifest: manifests(), instances: instances() })
  const tell = (except: InstanceId | undefined, delta: SystemDelta) => {
    for (const e of [...entries.values()]) if (e.instance.id !== except) quiet(() => e.component.onSystemUpdated?.(id, delta))
    for (const w of [...watchers]) quiet(() => w(delta))
  }

  // ponytail: per-correlation counts are kept for the 10k most recent correlations.
  const counts = new Map<string, number>()
  function admit(t: Omit<Trace, 'at'>): Result<never> | undefined {
    const at = Date.now(), emit = (x: Trace) => observers.forEach(o => quiet(() => o(x)))
    if (burst++ === 0) setTimeout(() => { burst = 0 })
    const n = (counts.get(t.correlation) ?? 0) + 1
    counts.delete(t.correlation); counts.set(t.correlation, n)
    if (counts.size > 10_000) counts.delete(counts.keys().next().value!)
    const why = n > budget ? `correlation ${t.correlation} exceeded ${budget} operations`
      : burst > burstMax ? `more than ${burstMax} operations before the event loop was idle` : undefined
    if (!why) return void emit({ ...t, at })
    emit({ ...t, kind: 'drop', reason: why, at })
    if (n === budget + 1 || burst === burstMax + 1) report({ code: 'loop', message: why }, { from: t.from, op: t.op, correlation: t.correlation })
    return fail('loop', why)
  }

  let dispatching = false
  const queue: (() => void)[] = []
  const dispatch = (run: () => void) => {
    if (dispatching) return void queue.push(run)
    dispatching = true
    try { run(); while (queue.length) queue.shift()!() } finally { dispatching = false; queue.length = 0 }
  }

  /** Hand `from`'s output of op `name` (a notification, or an action's outcome) to everyone subscribed to it. */
  function deliver(from: InstanceId, name: string, payload: unknown, correlation: string) {
    dispatch(() => {
      for (const s of [...subs]) {
        if (s.op.name !== name || (s.from && s.from !== from) || !subs.has(s) || !entries.has(s.owner)) continue
        if (admit({ kind: 'deliver', correlation, from, to: s.owner, op: name })) continue
        const info = { from, op: name, correlation }
        const oops = (err: any) => report({ code: 'handler', message: String(err?.message ?? err) }, info)
        try { void Promise.resolve(s.fn(payload, { system: id, from, op: name, correlation })).catch(oops) } catch (err) { oops(err) }
      }
    })
  }

  function notify(from: InstanceId, n: Notified): Result<void> {
    const name = n.op.name, def = entries.get(from)?.instance.manifest.ops.find(d => d.name === name)
    if (!def || def.input || !def.output) return fail('validation', `${from} does not notify ${name}`)
    if (!Value.Check(def.output, n.payload)) return fail('validation', `payload invalid for ${name}`)
    const refused = admit({ kind: 'notify', correlation: n.correlation, from, op: name, data: n.payload })
    if (refused) return refused
    deliver(from, name, n.payload, n.correlation)
    return ok(undefined)
  }

  async function call(from: InstanceId, c: Called): Promise<Result<unknown>> {
    const name = c.op.name
    const refused = admit({ kind: 'call', correlation: c.correlation, from, to: c.target, op: name, data: c.input })
    if (refused) return refused
    const e = entries.get(c.target)
    if (!e) return fail('unknown-target', `no instance ${c.target} in ${id}`)
    const def = e.instance.manifest.ops.find(o => o.name === name)
    if (!def?.input) return fail('unknown-action', `${c.target} has no op ${name} taking input`)
    if (!Value.Check(def.input, c.input)) return fail('validation', `input invalid for ${name}`)
    try {
      const inv = { system: id, from, target: c.target, op: name, input: c.input, correlation: c.correlation, via: c.via }
      const r = await e.component.onAction(e.base.within(c.correlation), inv)
      if (r.type !== 'success') return r
      if (!def.output) return ok(undefined)
      if (!Value.Check(def.output, r.data)) return fail('validation', `output invalid for ${name}`)
      if (entries.get(c.target) === e) deliver(c.target, name, r.data, c.correlation) // an action's outcome is a source too
      return r
    } catch (err: any) { return fail('handler', String(err?.message ?? err)) }
  }

  const gone = (who: InstanceId) => fail('unknown-target', `${who} is not registered in ${id}`)
  const coreFor = (who: InstanceId, entry: () => Entry | undefined): Core => ({
    instanceId: who, system: snapshot, fresh,
    notify: async n => entry() ? notify(who, n) : gone(who),
    call: c => entry() ? call(who, c) : Promise.resolve(gone(who)),
    subscribe: s => {
      if (!entry()) return () => {}
      const sub: Sub = { ...s, owner: who }; subs.add(sub); return () => { subs.delete(sub) }
    },
    use: (name, input, correlation) => {
      const b = bindings.get(`${who}\u0000${name}`)
      if (!entry()) return Promise.resolve(gone(who))
      if (!b) return Promise.resolve(fail('unavailable', `${who}'s dependency ${name} is not bound in ${id}`))
      const op = entries.get(b.to)?.instance.manifest.ops.find(o => o.name === b.op)
      return op ? call(who, { target: b.to, op, input, correlation }) : Promise.resolve(fail('unavailable', `${b.to} is gone`))
    },
  })

  const self: SystemRuntime = {
    id,
    snapshot,
    register(iid, component, o = {}) {
      if (entries.has(iid)) throw new Error(`${id} already has an instance ${iid}`)
      const types = manifests().length
      let entry: Entry | undefined
      const base = (o.wrap ?? (h => h))(handle(coreFor(iid, () => entries.get(iid) === entry ? entry : undefined)))
      entry = { instance: { id: iid, manifest: component.manifest }, component, base }
      entries.set(iid, entry)
      quiet(() => component.onAddedToSystem?.(base))
      tell(iid, { type: 'added', instances: [entry.instance] })
      if (manifests().length !== types) tell(undefined, { type: 'manifest', manifest: manifests() })
      return base
    },
    unregister(iid) {
      const e = entries.get(iid)
      if (!e) return
      const types = manifests().length
      entries.delete(iid)
      for (const s of subs) if (s.owner === iid) subs.delete(s)
      for (const [l, off] of links) if (l.from === iid || l.to === iid) { off(); links.delete(l) }
      for (const [k, b] of bindings) if (b.from === iid || b.to === iid) bindings.delete(k)
      quiet(() => e.component.onRemovedFromSystem?.(id))
      tell(undefined, { type: 'removed', instances: [e.instance] })
      if (manifests().length !== types) tell(undefined, { type: 'manifest', manifest: manifests() })
    },
    component: iid => entries.get(iid)?.component,
    connect(from, output, to, op) {
      const problem = routeProblem(entries.get(from)?.instance.manifest, output, entries.get(to)?.instance.manifest, op, { from, to })
      if (problem) throw new Error(`connect: ${problem}`)
      const sub: Sub = {
        op: output, from, owner: to,
        fn: (payload, d) => call(from, { target: to, op, input: payload, correlation: d.correlation, via: output.name })
          .then(r => { if (r.type === 'error') report(r.error, { from, op: op.name, correlation: d.correlation }) }),
      }
      const link: Link = { from, output: output.name, to, op: op.name }
      const off = () => { subs.delete(sub); links.delete(link) }
      subs.add(sub); links.set(link, off)
      return off
    },
    links: () => [...links.keys()],
    bind(from, dependency, to, op) {
      const dep = entries.get(from)?.instance.manifest.dependencies?.find(d => d.name === dependency)
      const target = entries.get(to)?.instance.manifest.ops.find(o => o.name === op.name)
      if (!dep) throw new Error(`bind: ${from} has no dependency ${dependency}`)
      if (!target || shape(target) !== shape(dep.op)) throw new Error(`bind: ${to}'s ${op.name} does not have the shape ${dependency} needs`)
      const key = `${from}\u0000${dependency}`, b: Binding = { from, dependency, to, op: op.name }
      bindings.set(key, b)
      return () => { if (bindings.get(key) === b) bindings.delete(key) }
    },
    bindings: () => [...bindings.values()],
    observe(fn) { observers.add(fn); return () => { observers.delete(fn) } },
    updates(fn) { watchers.add(fn); return () => { watchers.delete(fn) } },
  }
  return self
}

export const Systems = { create }
