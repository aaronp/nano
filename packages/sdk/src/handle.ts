import { fail, type CallFn, type InstanceId, type NotifyFn, type Result, type SubscribeFn, type System, type SystemInstance } from './types'

/** The raw functions a System gives one registered instance. `fresh` makes a new correlation id. */
export type Core = {
  instanceId: InstanceId; system: () => System; fresh: () => string
  notify: NotifyFn; call: CallFn; subscribe: SubscribeFn
  use: (name: string, input: unknown, correlation: string) => Promise<Result<unknown>>
}

// A throwing wrapper must never escape notify/call.
const safe = <A, R>(fn: (a: A) => Promise<R>) => (a: A) =>
  Promise.resolve().then(() => fn(a)).catch((e: any) => fail('handler', String(e?.message ?? e)) as R)

/** A handle over `core`. With a `correlation`, everything it does carries it; without, each operation starts one. */
export function handle(core: Core, correlation?: string): SystemInstance {
  const cid = () => correlation ?? core.fresh()
  return {
    get system() { return core.system() },
    instanceId: core.instanceId,
    correlation,
    notify: (op, payload) => core.notify({ op, payload, correlation: cid() }),
    call: (target, op, input) => core.call({ target, op, input, correlation: cid() }) as Promise<any>,
    subscribe: (op, fn, opts) => core.subscribe({ op, from: opts?.from, fn: (p, d) => fn(p as never, { ...d, handle: handle(core, d.correlation) }) }),
    use: (name, input) => core.use(name, input, cid()),
    within: id => handle(core, id),
    withNotify: fn => handle({ ...core, notify: safe(n => fn(n, core.notify)) }, correlation),
    withCall: fn => handle({ ...core, call: safe(c => fn(c, core.call)) }, correlation),
    withSubscribe: fn => handle({ ...core, subscribe: s => { try { return fn(s, core.subscribe) } catch { return () => {} } } }, correlation),
  }
}
