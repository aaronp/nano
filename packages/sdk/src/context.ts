import { fail, type CallFn, type Context, type Instance, type Manifest, type PublishFn, type SubscribeFn } from './types'

/** The raw functions a scope gives a context. `fresh` makes a new correlation id. */
export type Core = {
  self: string; manifest: Manifest; publish: PublishFn; call: CallFn; subscribe: SubscribeFn
  instances: () => Instance[]; watch(notify: () => void): () => void; fresh: () => string
}

// A throwing wrapper must never escape publish/call.
const safe = <A, R>(fn: (a: A) => Promise<R>) => (a: A) =>
  Promise.resolve().then(() => fn(a)).catch((e: any) => fail('handler', String(e?.message ?? e)) as R)

/** A context over `core`. With a `correlation`, everything it does carries it; without, each operation starts one. */
export function context(core: Core, correlation?: string): Context {
  const cid = () => correlation ?? core.fresh()
  const ctx: Context = {
    self: core.self,
    manifest: core.manifest,
    correlation,
    publish: (op, payload) => core.publish({ op, payload, correlation: cid() }),
    call: (target, op, input) => core.call({ target, op, input, correlation: cid() }) as Promise<any>,
    subscribe: (op, fn, opts) => core.subscribe({ op, from: opts?.from, fn: (p, d) => fn(p as never, { ...d, ctx: context(core, d.correlation) }) }),
    instances: () => core.instances(),
    watch: fn => { fn(ctx.instances()); return core.watch(() => fn(ctx.instances())) },
    within: id => context(core, id),
    withPublish: fn => context({ ...core, publish: safe(p => fn(p, core.publish)) }, correlation),
    withCall: fn => context({ ...core, call: safe(c => fn(c, core.call)) }, correlation),
    withSubscribe: fn => context({ ...core, subscribe: s => { try { return fn(s, core.subscribe) } catch { return () => {} } } }, correlation),
  }
  return ctx
}
