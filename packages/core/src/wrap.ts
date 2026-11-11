// Wrapping a live instance: the wrapper takes its id and ops, keeps the original in a runtime of its own, and routes
// every call and delivery through a strategy. Neighbours' subscriptions and calls don't change.
import { Type } from 'typebox'
import { Components, type Instance } from './component'
import { err, isOk, ok, Ops, type Owner, type Result } from './data'
import type { Environment } from './env'
import { Registries } from './registry'
import { Runtimes, type Runtime } from './runtime'

/** A value that owns a runtime: its parts, which anyone holding the value can replace, rewire, call or watch. */
export type HasRuntime = { runtime: Runtime }
/** Whether a value owns a runtime. */
export const hasRuntime = (v: unknown): v is HasRuntime => {
  const r = (v as { runtime?: Partial<Runtime> } | null | undefined)?.runtime
  return !!r && typeof r.call === 'function' && typeof r.notify === 'function' && typeof r.listen === 'function' && !!r.registry
}

/** Calls `op` on one part, through the wrapper's runtime. */
export type Call = (part: string, op: string, arg: unknown) => Promise<Result>
/** Where one call to the wrapper goes. `pause`/`resume` are for strategies that hold calls back. */
export type Strategy = ((op: string, arg: unknown, parts: string[], call: Call) => Promise<Result>) & { pause?(): void; resume?(): Promise<void> }

const forward: Strategy = (op, arg, parts, call) => (parts[0] === undefined ? Promise.resolve(err('no parts')) : call(parts[0], op, arg))

/** Built-in strategies. */
export const Strategies = {
  /** To the first part. */
  forward,
  /** To every part; the first success is the value, every result the detail. An error only if every part fails. */
  broadcast: (async (op, arg, parts, call) => {
    const all = await Promise.all(parts.map(p => call(p, op, arg))), won = all.find(isOk)
    return won ? ok(won.value, all) : err('every part failed', all)
  }) as Strategy,
  /** To every part at once; the first success wins, the rest run to the end and are ignored. */
  race: (async (op, arg, parts, call) => {
    try { return ok((await Promise.any(parts.map(p => call(p, op, arg).then(r => (isOk(r) ? r : Promise.reject(r)))))).value) }
    catch (e) { return err('every part failed', (e as AggregateError).errors ?? []) }
  }) as Strategy,
  /** `inner`, except while paused: then calls queue, and resume sends them on in order before any new one. */
  buffer(inner: Strategy = forward): Strategy {
    let paused = false, draining = false
    const queue: (() => Promise<void>)[] = []
    // ponytail: unbounded queue, no timeout; add a cap when a long pause is real
    const s: Strategy = (op, arg, parts, call) => (paused || draining
      ? new Promise(res => { queue.push(async () => res(await inner(op, arg, parts, call))) })
      : inner(op, arg, parts, call))
    s.pause = () => { paused = true }
    s.resume = async () => {
      if (draining) return
      paused = false; draining = true
      while (queue.length) await queue.shift()!()
      draining = false
    }
    return s
  },
}

const IGNORED = Type.Unknown({ description: 'Ignored: any value triggers it' })
/** The wrapper's own ops. */
export const WrapperOps = {
  pause: Ops.action('composable/wrapper', 'pause', IGNORED, Type.Void(), { description: 'Holds calls back (with a buffering strategy) until resume' }),
  resume: Ops.action('composable/wrapper', 'resume', IGNORED, Type.Void(), { description: 'Sends the held calls on, in order, then lets calls through' }),
  parts: Ops.action('composable/wrapper', 'parts', Type.Null({ description: 'Nothing' }), Type.Array(Type.String(), { description: 'The part ids, in order added' }), { description: "The wrapper's parts" }),
}

type Wrapper = HasRuntime & { strategy: Strategy }
const partsOf = (rt: Runtime) => rt.registry.snapshot().instances.map(i => i.id).filter(i => i !== 'registry')

/** Puts a wrapper at `id`, with the instance that was there as its one part (under the same id). */
export function wrap(outer: Runtime, id: string, strategy: Strategy, opts: { map?: Record<string, { part: string; op: string }>; owner?: Owner } = {}): Result<HasRuntime> {
  const x: Instance | undefined = outer.registry.get(id)
  if (!x) return err(`no instance ${id} in ${outer.registry.id}`)
  const from = { registry: outer.registry.id, instance: id }
  // a part's call to something not inside (or to the registry) goes on to the outer runtime, as if from the wrapper
  const inner = Runtimes.create(Registries.create(`${outer.registry.id}/${id}`), rt => ({
    ...rt,
    call: (f, t, op, arg) => (t === 'registry' || !rt.registry.get(t) ? outer.call(from, t, op, arg) : rt.call(f, t, op, arg)),
  }))
  const call: Call = (part, op, arg) => inner.call(from, part, op, arg)
  const unwrapped = (r: Result) => { if (!isOk(r)) throw new Error(r.error); return r.value }

  let env: Environment | undefined
  const c = Components.create<Wrapper>(x.component.id, e => { env = e; return { runtime: inner, strategy } },
    x.component.description === undefined ? {} : { description: x.component.description })
  for (const [key, a] of x.actions) {
    if (!a.run) { c.action(a.op); continue }   // a source only: published through the republish below
    const m = opts.map?.[key]
    c.action(a.op, async (_, arg) => unwrapped(await strategy(m?.op ?? key, arg, m ? [m.part] : partsOf(inner), call)))
  }
  c.action(WrapperOps.pause, w => { w.strategy.pause?.() })
  c.action(WrapperOps.resume, async w => { await w.strategy.resume?.() })
  c.action(WrapperOps.parts, w => partsOf(w.runtime))
  const wrapper = Components.instantiate(c)

  // what a part publishes, of the ops the wrapper offers, comes out from the wrapper
  inner.listen(t => {
    const a = wrapper.actions.get(t.kind === 'publish' ? t.op : '')
    if (t.kind === 'publish' && isOk(t.result) && t.from.instance !== 'registry' && a) void env?.notify(a.op, t.data)
  })

  const r = outer.registry.replace(id, wrapper, opts.owner)   // first: X loses its outer handle...
  if (!isOk(r)) return r
  inner.registry.add(id, x, { kind: 'wrapper', name: id })    // ...then gains the inner one, never both
  return ok(wrapper.value)
}

/** Puts a one-part wrapper's part back at `id`, and drops the wrapper. */
export function unwrap(outer: Runtime, id: string): Result<void> {
  const w = outer.registry.get(id)?.value
  if (!hasRuntime(w)) return err(`${id} in ${outer.registry.id} is not a wrapper`)
  const parts = partsOf(w.runtime)
  if (parts.length !== 1) return err(`${id} has ${parts.length} parts; unwrap needs exactly one`)
  const part = w.runtime.registry.get(parts[0]!)!
  w.runtime.registry.remove(parts[0]!)   // first: the part loses its inner handle...
  return outer.registry.replace(id, part)   // ...then gets its outer one back
}
