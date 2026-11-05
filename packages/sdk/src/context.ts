import { fail, type CallFn, type Capabilities, type Context, type EmitFn, type Instance, type Invocation } from './types'

type Core = { self: Instance; capabilities: () => Capabilities; emit: EmitFn; call: CallFn }
const cores = new WeakMap<Context, Core>()

// A throwing wrapper must never escape emit/call.
const safe = <A, R>(fn: (a: A) => Promise<R>) => (a: A) =>
  Promise.resolve().then(() => fn(a)).catch((e: any) => fail('handler', String(e?.message ?? e)) as R)

/** Build a context from raw intent functions. `stack` is the call stack its emits and calls carry. */
export function context(core: Core, stack: Invocation[] = []): Context {
  const ctx: Context = {
    self: core.self,
    capabilities: () => core.capabilities(),
    emit: (event, payload) => core.emit({ event, payload, scope: { stack } }),
    call: (target, action, input) => core.call({ target, action, input, scope: { stack } }) as Promise<any>,
    withEmit: fn => context({ ...core, emit: safe(e => fn(e, core.emit)) }, stack),
    withCall: fn => context({ ...core, call: safe(c => fn(c, core.call)) }, stack),
    withCapabilities: fn => context({ ...core, capabilities: () => fn(core.capabilities()) }, stack),
  }
  cores.set(ctx, core)
  return ctx
}

/** The same context (wrappers included) bound to a call stack. Internal: only the registry sets stacks. */
export const scoped = (ctx: Context, stack: Invocation[]) => context(cores.get(ctx)!, stack)
