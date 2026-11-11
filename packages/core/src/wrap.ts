// Wrapping a live instance: the wrapper takes its id and ops, keeps the original in a runtime of its own, and routes
// every call and delivery through a strategy. Neighbours' subscriptions and calls don't change.
import { Type } from 'typebox'
import { Components, type Instance } from './component'
import { err, isOk, ok, Ops, type Owner, type Result } from './data'
import type { Environment } from './env'
import { Registries } from './registry'
import { Runtimes, type Runtime, type Trace } from './runtime'

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
      ? new Promise(res => { queue.push(() => inner(op, arg, parts, call).then(res, e => res(err(e instanceof Error ? e.message : String(e))))) })
      : inner(op, arg, parts, call))
    s.pause = () => { paused = true }
    s.resume = async () => {
      if (draining) return
      paused = false; draining = true
      try { while (queue.length) await queue.shift()!() } finally { draining = false }
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

type Wrapper = HasRuntime & { strategy: Strategy; owner?: Owner }
const partsOf = (rt: Runtime) => rt.registry.snapshot().instances.map(i => i.id).filter(i => i !== 'registry')

/** Which outward calls an instance may make: coordinates (`registry/target/op`, `*` matches anything) allowed, then denied. */
export type Selectors = { allow?: string[]; deny?: string[] }
/** Whether `coord` matches `selector`: literal, apart from `*`. */
export const matches = (selector: string, coord: string): boolean =>
  new RegExp(`^${selector.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's').test(coord)
const permitted = (g: Selectors | undefined, coord: string) => !g || ((!g.allow || g.allow.some(s => matches(s, coord))) && !g.deny?.some(s => matches(s, coord)))

/** Puts a wrapper at `id`, with the instance that was there as its one part (under the same id). */
export function wrap(outer: Runtime, id: string, strategy: Strategy, opts: { map?: Record<string, { part: string; op: string }>; owner?: Owner; outward?: Selectors } = {}): Result<HasRuntime> {
  const x: Instance | undefined = outer.registry.get(id)
  if (!x) return err(`no instance ${id} in ${outer.registry.id}`)
  const from = { registry: outer.registry.id, instance: id }
  // a part's call to something not inside (or to the registry) goes on to the outer runtime, as if from the wrapper
  const refusals = new Set<(t: Trace) => void>()   // refusals happen in the policy, so it traces them itself
  const inner = Runtimes.create(Registries.create(`${outer.registry.id}/${id}`), rt => ({
    ...rt,
    listen: fn => { const off = rt.listen(fn); refusals.add(fn); return () => { off(); refusals.delete(fn) } },
    async call(f, t, op, arg) {
      if (t !== 'registry' && rt.registry.get(t)) return rt.call(f, t, op, arg)
      const coord = `${outer.registry.id}/${t}/${op}`
      if (permitted(opts.outward, coord)) return outer.call(from, t, op, arg)
      const result = err(`${id} may not call ${coord}`)
      refusals.forEach(fn => { try { fn({ kind: 'call', time: Date.now(), from: f, target: t, op, data: arg, result }) } catch { /* an observer can't change the call */ } })
      return result
    },
  }))
  const call: Call = (part, op, arg) => (part !== 'registry' && inner.registry.get(part) ? inner.call(from, part, op, arg) : Promise.resolve(err(`no part ${part} in ${id}`)))
  // ponytail: one set for the whole wrapper, so a call may also wait for a concurrent call's publishes
  const republishing = new Set<Promise<unknown>>()
  const unwrapped = (r: Result) => { if (!isOk(r)) throw new Error(r.error); return r.value }

  const before = outer.registry.snapshot().instances.find(i => i.id === id)?.owner
  let env: Environment | undefined
  const c = Components.create<Wrapper>(x.component.id, e => { env = e; return { runtime: inner, strategy, ...(before && { owner: before }) } },
    x.component.description === undefined ? {} : { description: x.component.description })
  for (const [key, a] of x.actions) {
    if (!a.run) { c.action(a.op); continue }   // a source only: published through the republish below
    const m = opts.map?.[key]
    c.action(a.op, async (_, arg) => {
      const r = await strategy(m?.op ?? key, arg, m ? [m.part] : partsOf(inner), call)
      await Promise.all(republishing)   // as an unwrapped call would: its publishes are delivered before it returns
      return unwrapped(r)
    })
  }
  c.action(WrapperOps.pause, w => { w.strategy.pause?.() })
  c.action(WrapperOps.resume, async w => { await w.strategy.resume?.() })
  c.action(WrapperOps.parts, w => partsOf(w.runtime))
  const wrapper = Components.instantiate(c)

  // what a part publishes, of the ops the wrapper offers, comes out from the wrapper
  inner.listen(t => {
    const a = wrapper.actions.get(t.kind === 'publish' ? t.op : '')
    if (t.kind !== 'publish' || !isOk(t.result) || t.from.instance === 'registry' || !a || !env) return
    const p = env.notify(a.op, t.data).finally(() => republishing.delete(p))
    republishing.add(p)
  })

  // a wrapper that loses its last handle takes its parts with it (a replace hand-over regains one within the tick)
  const removed = env!.removed
  env!.removed = co => { removed(co); queueMicrotask(() => { if (!env!.handles().length) for (const p of partsOf(inner)) inner.registry.remove(p) }) }
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
  const r = outer.registry.replace(id, part, (w as Partial<Wrapper>).owner)   // ...then gets its outer one (and owner) back
  if (isOk(r)) outer.registry.label(id, { 'nano/guarded': null })
  return r
}

/** Wraps the instance at `id` in a one-part forwarding wrapper that may call outward only as `outward` allows. */
export const guard = (outer: Runtime, id: string, outward: Selectors): Result<HasRuntime> => wrap(outer, id, Strategies.forward, { outward })
