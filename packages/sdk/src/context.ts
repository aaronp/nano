import { fail, type CallFn, type Context, type EmitFn, type Frame, type Instance, type OnFn } from './types'

export type Core = {
  self: string; emit: EmitFn; call: CallFn; on: OnFn
  instances: () => Instance[]; watch(notify: () => void): () => void
}
const made = new WeakMap<Context, { core: Core; stack: Frame[] }>()

// A throwing wrapper must never escape emit/call.
const safe = <A, R>(fn: (a: A) => Promise<R>) => (a: A) =>
  Promise.resolve().then(() => fn(a)).catch((e: any) => fail('handler', String(e?.message ?? e)) as R)

/** Build a context from raw intent functions. `stack` is the causal chain its emits and calls carry. */
export function context(core: Core, stack: Frame[] = []): Context {
  const ctx: Context = {
    self: core.self,
    emit: (event, payload) => core.emit({ event, payload, stack }),
    call: (target, action, input) => core.call({ target, action, input, stack }) as Promise<any>,
    on: (event, fn, opts) => core.on({ event, from: opts?.from, fn: (p, d) => fn(p as never, { ...d, ctx: context(core, d.stack) }) }),
    instances: () => core.instances(),
    watch: fn => { fn(ctx.instances()); return core.watch(() => fn(ctx.instances())) },
    withEmit: fn => context({ ...core, emit: safe(e => fn(e, core.emit)) }, stack),
    withCall: fn => context({ ...core, call: safe(c => fn(c, core.call)) }, stack),
    withOn: fn => context({ ...core, on: s => { try { return fn(s, core.on) } catch { return () => {} } } }, stack),
    withInstances: fn => context({ ...core, instances: () => fn(core.instances()) }, stack),
  }
  made.set(ctx, { core, stack })
  return ctx
}

/** The same context (wrappers included) carrying `stack`. Internal: only scopes and composites set stacks. */
export const scoped = (ctx: Context, stack: Frame[]) => context(made.get(ctx)!.core, stack)
export const stackOf = (ctx: Context) => made.get(ctx)?.stack ?? []
