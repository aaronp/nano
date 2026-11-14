/**
 * Messages: one message in one runtime — `sent` (with its kind and chain), policed, its input checked, the target built
 * or reused, run with the timeout, its output checked, then `delivered` (or `denied`); a successful action result is
 * then emitted, without waiting. And a client by op name over such messages.
 *
 *   await send(live, 'r', 'host', 'db', 'acme.KV/get', 'k')                // NanoResult<unknown>; a call starting a chain
 *   await client(live, 'r', 'host', 'db', () => undefined).get('k')       // the same, by op name
 */
import type { AppDeployment } from '../deployment.ts'
import { port } from '../iface.ts'
import type { Handler, Implementation } from '../implementation.ts'
import { Policies, type Policy } from '../policy.ts'
import type { Registry } from '../registry.ts'
import { failure, isNanoResult, success, type NanoResult } from '../result.ts'
import { emit, type On } from './emit.ts'
import type { stream } from './stream.ts'

/** What a message needs of the application, read live. */
export type Live = {
  now(): AppDeployment
  readonly registry: Registry
  readonly policies: Record<string, Policy>
  readonly timeoutMs: number
  readonly trace: ReturnType<typeof stream>
  /** A build: the handlers by port, and the implementation they were made from. */
  instance(pod: string): Promise<NanoResult<{ implementation: Implementation; handlers: ReadonlyMap<string, Handler> }>>
  /** The live `on` subscriptions, in the order made. */
  readonly ons: Set<On>
  /** Deliveries under way, so `close()` can let them settle. */
  readonly flying: Set<Promise<unknown>>
  /** Whether `close()` has been called: nothing new is delivered. */
  closed(): boolean
}

/** A message's kind and chain (`correlation`, `cause`); `run` carries an `on` delivery instead of an action. */
type How = { kind: 'call' | 'pipe' | 'on'; correlation?: string; cause?: string; run?: () => Promise<NanoResult<unknown>> }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const TIMEOUT = Symbol('timeout')

/** `work()` within `ms`: its value, or `threw` / `timeout` naming `what`. Never throws. */
export async function within<T>(work: () => T | Promise<T>, ms: number, what: string): Promise<NanoResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(TIMEOUT), ms) })
  try {
    return success(await Promise.race([Promise.resolve().then(work), late]))
  } catch (e) {
    return e === TIMEOUT ? failure('timeout', `${what} took over ${ms}ms`) : failure('threw', `${what}: ${msg(e)}`)
  } finally {
    clearTimeout(timer)
  }
}

const impl = (live: Live, pod: string) => live.registry.implementation(live.now().pods[pod]?.implementation ?? '')
const action = (i: Implementation | undefined, p: string) =>
  i?.provides.flatMap(i => Object.values(i.ops).filter(o => o.kind === 'action' && port(i, o) === p))[0]

/** Why `runtime`'s policy refuses `from`->`to` with `data`, or undefined. A throw, a Promise or no verdict refuses. */
export function refusal(live: Live, runtime: string, from: string, to: string, data: unknown): string | undefined {
  const policy = Object.hasOwn(live.policies, runtime) ? live.policies[runtime]! : Policies.allowAll()
  try {
    const v = policy.isAllowed(from, to, data) as { approved?: unknown; reason?: unknown; then?: unknown } | undefined
    if (typeof v?.then === 'function') { Promise.resolve(v).catch(() => {}); return 'policy gave no verdict' }
    if (v?.approved === true) return undefined
    return v?.approved === false && typeof v.reason === 'string' ? v.reason : 'policy gave no verdict'
  } catch (e) {
    return `policy threw: ${msg(e)}`
  }
}

async function deliver(live: Live, to: string, p: string, input: unknown): Promise<NanoResult<unknown>> {
  const asked = action(impl(live, to), p)
  if (!asked) return failure('unknown-op', `${to} has no action ${p}`)
  if (asked.input && !asked.input.check(input)) return failure('invalid-input', `${p}: input does not fit ${asked.input.type}`)
  const made = await live.instance(to)
  if (!made.ok) return made
  // The op as the build knows it: an apply may have changed the pod while this build was under way.
  const o = action(made.value.implementation, p), h = made.value.handlers.get(p)
  if (!o || !h) return failure('unknown-op', `${to} has no action ${p}`)
  if (o.input && !o.input.check(input)) return failure('invalid-input', `${p}: input does not fit ${o.input.type}`)
  const ran = await within(() => h(input), live.timeoutMs, `${to} ${p}`)
  if (!ran.ok) { live.trace.emit({ type: 'failure', pod: to, reason: ran.fail.reason }); return ran }
  const r = ran.value
  if (!isNanoResult(r)) return failure('invalid-output', `${p}: returned something other than a NanoResult`)
  if (r.ok && o.output && !o.output.check(r.value)) return failure('invalid-output', `${p}: output does not fit ${o.output.type}`)
  return r
}

/**
 * One message from `from` to `to`'s port `p`, in runtime `runtime`, policed by `refusal`. With no `correlation` it
 * starts a chain. An action's successful result is emitted from `to`, each delivery caused by this message.
 */
export async function send(live: Live, runtime: string, from: string, to: string, p: string, input: unknown, how: How = { kind: 'call' }): Promise<NanoResult<unknown>> {
  const { trace } = live, id = trace.id(), { kind, correlation = id, cause, run } = how
  trace.emit({ type: 'sent', id, runtime, kind, from, to, port: p, correlation, ...(cause !== undefined && { cause }) })
  const reason = refusal(live, runtime, from, to, input)
  if (reason !== undefined) { trace.emit({ type: 'denied', id, reason }); return failure('denied', reason) }
  const t0 = performance.now()
  const r = await (run ? run() : deliver(live, to, p, input))
  trace.emit({ type: 'delivered', id, result: r, ms: performance.now() - t0 })
  if (r.ok && !run) void emit(live, to, p, r.value, { correlation, cause: id })
  return r
}

/**
 * A client by op name from `from` to `to` in `runtime`. `gone()` is asked at each call, before anything is sent: a
 * Fail it gives is the call's result.
 */
export function client(live: Live, runtime: string, from: string, to: string, gone: () => NanoResult<never> | undefined): Record<string, (input: unknown) => Promise<NanoResult<unknown>>> {
  const call = async (name: string, input: unknown): Promise<NanoResult<unknown>> => {
    const why = gone()
    if (why) return why
    const ports = (impl(live, to)?.provides ?? []).flatMap(i => Object.values(i.ops).filter(o => o.kind === 'action' && o.name === name).map(o => port(i, o)))
    if (ports.length === 0) return failure('unknown-op', `${to} has no action ${name}`)
    if (ports.length > 1) return failure('ambiguous', `${to}: ${name} is an action of more than one interface`)
    return send(live, runtime, from, to, ports[0]!, input)
  }
  // ponytail: any name reads as an op (a Proxy) except `then`, so awaiting a client is harmless; an op named `then` is unreachable.
  return new Proxy({}, { get: (_, name) => (typeof name === 'string' && name !== 'then' ? (input: unknown) => call(name, input) : undefined) })
}
