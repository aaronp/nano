import Value from 'typebox/value'
import { context, type Core } from '../context'
import {
  fail, notAllowed, ok, roleOf, routeProblem,
  type Called, type Component, type ComponentFactory, type Context, type Created, type Instance, type Manifest,
  type Op, type Published, type Result, type Subscribed, type SystemError,
} from '../types'

/** One observed operation. `drop` means it was refused (muted, or a loop); `reason` says why. */
export type Trace = {
  kind: 'publish' | 'call' | 'deliver' | 'drop'
  correlation: string; from: string; to?: string; op: string; data?: unknown; reason?: string; at: number
}
export type ErrorInfo = { from: string; op: string; correlation: string }

/** A set of named instances sharing one bus. A container makes its own scope for its children. */
export type Scope = {
  /** Create and add an instance. `correlation`: the trigger that created it (default: a new one). */
  add<F extends ComponentFactory<any>>(name: string, factory: F, opts?: { wrap?: (c: Context) => Context; correlation?: string }): Promise<Created<F>>
  remove(name: string): Promise<void>
  component(name: string): Component | undefined
  /** Feed `from`'s publication into `to`'s op. Throws if either side doesn't fit; returns unroute. */
  route(from: string, publication: Op, to: string, op: Op): () => void
  /** A context for a party that is not a component, e.g. the page. Give it a manifest to let it publish. */
  context(name: string, manifest?: Manifest): Context
  /** Every publish, call, delivery and drop, as it happens. */
  observe(fn: (t: Trace) => void): () => void
  /** A muted instance's publishes and calls are refused, and nothing is delivered to it. */
  mute(name: string, muted?: boolean): void
  clear(): Promise<void>
}

type Entry = { name: string; manifest: Manifest; app: Context; component?: Component } // no component while being created
type Sub = Subscribed & { owner?: Entry; who: string }
type Watch = { owner?: Entry; notify: () => void }

/**
 * Synchronous pub/sub, after kerits' EventBus: handlers run in subscription order; a publish made while handlers
 * run is queued and delivered after the current round (FIFO). Every operation passes `admit`: muting, a budget of
 * operations per correlation (loops), and a backstop on operations per burst (until the event loop is idle).
 */
function create(opts: { budget?: number; burst?: number; onError?: (e: SystemError, info: ErrorInfo) => void } = {}): Scope {
  const entries = new Map<string, Entry>(), parties = new Set<string>()
  const subs = new Set<Sub>(), watchers = new Set<Watch>(), observers = new Set<(t: Trace) => void>(), muted = new Set<string>()
  const budget = opts.budget ?? 1000, burstMax = opts.burst ?? 100_000
  const prefix = Math.random().toString(36).slice(2, 8)
  let seq = 0, burst = 0
  const fresh = () => `${prefix}-${++seq}`
  const quiet = (f: () => void) => { try { f() } catch {} }
  const report = (e: SystemError, info: ErrorInfo) => quiet(() => opts.onError?.(e, info))
  const present = (e?: Entry) => !e || entries.get(e.name) === e
  const notify = () => { for (const w of watchers) if (present(w.owner)) quiet(w.notify) }
  const instances = (): Instance[] => [...entries.values()].filter(e => e.component).map(e => ({ name: e.name, manifest: e.manifest }))

  // ponytail: per-correlation counts are kept for the 10k most recent correlations.
  const counts = new Map<string, number>()
  /** Record the operation, or refuse it: returns the refusal as a Result. */
  function admit(t: Omit<Trace, 'at'>): Result<never> | undefined {
    const at = Date.now(), emit = (x: Trace) => observers.forEach(o => quiet(() => o(x)))
    let why: string | undefined, loop = false
    if (muted.has(t.from) || (t.to !== undefined && muted.has(t.to))) why = 'muted'
    else {
      if (burst++ === 0) setTimeout(() => { burst = 0 })
      const n = (counts.get(t.correlation) ?? 0) + 1
      counts.delete(t.correlation); counts.set(t.correlation, n)
      if (counts.size > 10_000) counts.delete(counts.keys().next().value!)
      if (n > budget) { why = `correlation ${t.correlation} exceeded ${budget} operations`; loop = n === budget + 1 }
      else if (burst > burstMax) { why = `more than ${burstMax} operations before the event loop was idle`; loop = burst === burstMax + 1 }
    }
    if (!why) return void emit({ ...t, at })
    emit({ ...t, kind: 'drop', reason: why, at })
    if (why === 'muted') return notAllowed('muted')
    if (loop) report({ code: 'loop', message: why }, { from: t.from, op: t.op, correlation: t.correlation })
    return fail('loop', why)
  }

  let dispatching = false
  const queue: (() => void)[] = []
  const dispatch = (run: () => void) => {
    if (dispatching) return void queue.push(run)
    dispatching = true
    try { run(); while (queue.length) queue.shift()!() } finally { dispatching = false; queue.length = 0 }
  }

  function publish(from: string, manifest: Manifest | undefined, p: Published): Result<void> {
    const name = p.op.name, def = manifest?.ops.find(d => d.name === name)
    if (!def || roleOf(def) !== 'publication') return fail('validation', `${from} does not publish ${name}`)
    if (!Value.Check(def.output!, p.payload)) return fail('validation', `payload invalid for ${name}`)
    const refused = admit({ kind: 'publish', correlation: p.correlation, from, op: name, data: p.payload })
    if (refused) return refused
    dispatch(() => {
      for (const s of [...subs]) {
        if (s.op.name !== name || (s.from && s.from !== from) || !subs.has(s) || !present(s.owner)) continue
        if (admit({ kind: 'deliver', correlation: p.correlation, from, to: s.who, op: name })) continue
        const info = { from, op: name, correlation: p.correlation }
        const oops = (err: any) => report({ code: 'handler', message: String(err?.message ?? err) }, info)
        try { void Promise.resolve(s.fn(p.payload, { from, op: name, correlation: p.correlation })).catch(oops) } catch (err) { oops(err) }
      }
    })
    return ok(undefined)
  }

  async function call(from: string, c: Called): Promise<Result<unknown>> {
    const name = c.op.name
    const refused = admit({ kind: 'call', correlation: c.correlation, from, to: c.target, op: name, data: c.input })
    if (refused) return refused
    const e = entries.get(c.target)
    if (!e?.component) return fail('unknown-target', `no instance ${c.target}`)
    const def = e.manifest.ops.find(o => o.name === name)
    if (!def?.input) return fail('unknown-action', `${c.target} has no op ${name} taking input`)
    if (!Value.Check(def.input, c.input)) return fail('validation', `input invalid for ${name}`)
    try {
      const r = await e.component.onAction(e.app.within(c.correlation), { from, target: c.target, op: name, input: c.input, correlation: c.correlation })
      if (r.type !== 'success') return r
      if (!def.output) return ok(undefined)
      return Value.Check(def.output, r.data) ? r : fail('validation', `output invalid for ${name}`)
    } catch (err: any) { return fail('handler', String(err?.message ?? err)) }
  }

  const gone = (name: string) => fail('unknown-target', `instance ${name} was removed`)
  const coreFor = (name: string, owner: Entry | undefined, manifest: Manifest): Core => ({
    self: name, manifest, fresh, instances,
    publish: async p => present(owner) ? publish(name, manifest, p) : gone(name),
    call: c => present(owner) ? call(name, c) : Promise.resolve(gone(name)),
    subscribe: s => {
      if (!present(owner)) return () => {}
      const sub: Sub = { ...s, owner, who: name }; subs.add(sub); return () => { subs.delete(sub) }
    },
    watch: n => {
      if (!present(owner)) return () => {}
      const w: Watch = { owner, notify: n }; watchers.add(w); return () => { watchers.delete(w) }
    },
  })

  async function remove(name: string) {
    const e = entries.get(name)
    if (!e) return
    entries.delete(name)
    for (const s of subs) if (s.owner === e) subs.delete(s)
    for (const w of watchers) if (w.owner === e) watchers.delete(w)
    try { await e.component?.dispose?.() } catch (err: any) { report({ code: 'handler', message: String(err?.message ?? err) }, { from: name, op: 'dispose', correlation: '' }) }
    notify()
  }

  return {
    async add(name, factory, o = {}) {
      if (entries.has(name) || parties.has(name)) throw new Error(`duplicate instance ${name}`)
      const entry: Entry = { name, manifest: factory.manifest, app: undefined! }
      entries.set(name, entry)
      try {
        entry.app = (o.wrap ?? (c => c))(context(coreFor(name, entry, factory.manifest)))
        const component = await factory.create({ mountContext: entry.app.within(o.correlation ?? fresh()), appContext: entry.app })
        if (!present(entry)) { await component.dispose?.(); throw new Error(`instance ${name} was removed while being created`) }
        entry.component = component
        notify()
        return component
      } catch (err) { if (present(entry)) await remove(name); throw err }
    },
    remove,
    component: name => entries.get(name)?.component,
    route(from, publication, to, op) {
      const problem = routeProblem(entries.get(from)?.manifest, publication, entries.get(to)?.manifest, op, { from, to })
      if (problem) throw new Error(`route: ${problem}`)
      const sub: Sub = {
        op: publication, from, who: to,
        fn: (payload, d) => call(from, { target: to, op, input: payload, correlation: d.correlation })
          .then(r => { if (r.type === 'error') report(r.error, { from, op: op.name, correlation: d.correlation }) }),
      }
      subs.add(sub)
      return () => { subs.delete(sub) }
    },
    context(name, manifest = { id: { author: '', id: name }, ops: [] }) {
      if (entries.has(name)) throw new Error(`"${name}" is an instance; a party cannot take its name`)
      parties.add(name)
      return context(coreFor(name, undefined, manifest))
    },
    observe(fn) { observers.add(fn); return () => { observers.delete(fn) } },
    mute(name, on = true) { if (on) muted.add(name); else muted.delete(name) },
    async clear() { for (const name of [...entries.keys()].reverse()) await remove(name) },
  }
}

export const Scopes = { create }
