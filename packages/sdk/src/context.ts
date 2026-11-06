import { fail, type CallFn, type Context, type Frame, type Instance, type Manifest, type PublishFn, type SubscribeFn } from './types'

export type Core = {
  self: string; manifest: Manifest; publish: PublishFn; call: CallFn; subscribe: SubscribeFn
  instances: () => Instance[]; watch(notify: () => void): () => void
}
const made = new WeakMap<Context, { core: Core; stack: Frame[] }>()

// A throwing wrapper must never escape publish/call.
const safe = <A, R>(fn: (a: A) => Promise<R>) => (a: A) =>
  Promise.resolve().then(() => fn(a)).catch((e: any) => fail('handler', String(e?.message ?? e)) as R)

/** Build a context from raw intent functions. `stack` is the causal chain its publications and calls carry. */
export function context(core: Core, stack: Frame[] = []): Context {
  const ctx: Context = {
    self: core.self,
    manifest: core.manifest,
    publish: (op, payload) => core.publish({ op, payload, stack }),
    call: (target, op, input) => core.call({ target, op, input, stack }) as Promise<any>,
    subscribe: (from, op, fn) => core.subscribe({ from, op, fn: (p, d) => fn(p as never, { ...d, ctx: context(core, d.stack) }) }),
    instances: () => core.instances(),
    watch: fn => { fn(ctx.instances()); return core.watch(() => fn(ctx.instances())) },
    withPublish: fn => context({ ...core, publish: safe(p => fn(p, core.publish)) }, stack),
    withCall: fn => context({ ...core, call: safe(c => fn(c, core.call)) }, stack),
    withSubscribe: fn => context({ ...core, subscribe: s => { try { return fn(s, core.subscribe) } catch { return () => {} } } }, stack),
    withInstances: fn => context({ ...core, instances: () => fn(core.instances()) }, stack),
  }
  made.set(ctx, { core, stack })
  return ctx
}

/** The same context (wrappers included) carrying `stack`. Internal: only scopes and composites set stacks. */
export const scoped = (ctx: Context, stack: Frame[]) => context(made.get(ctx)!.core, stack)
export const stackOf = (ctx: Context) => made.get(ctx)?.stack ?? []
