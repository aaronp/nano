/**
 * Messages: one message in one runtime — `sent`, policed, its input checked, the target built or reused, run with the
 * timeout, its output checked, then `delivered` (or `denied`). And a client by op name over such messages.
 *
 *   await send(live, 'r', 'host', 'db', 'acme.KV/get', 'k')                // NanoResult<unknown>
 *   await client(live, 'r', 'host', 'db', () => undefined).get('k')       // the same, by op name
 */
import type { Deployment } from '../deployment.ts'
import { port } from '../iface.ts'
import type { Handler } from '../implementation.ts'
import { Policies, type Policy } from '../policy.ts'
import type { Registry } from '../registry.ts'
import { failure, isNanoResult, success, type NanoResult } from '../result.ts'
import type { stream } from './stream.ts'

/** What a message needs of the application, read live. */
export type Live = {
  now(): Deployment
  readonly registry: Registry
  readonly policies: Record<string, Policy>
  readonly timeoutMs: number
  readonly trace: ReturnType<typeof stream>
  instance(pod: string): Promise<NanoResult<ReadonlyMap<string, Handler>>>
}

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

async function deliver(live: Live, to: string, p: string, input: unknown): Promise<NanoResult<unknown>> {
  const o = impl(live, to)?.provides.flatMap(i => Object.values(i.ops).filter(o => o.kind === 'action' && port(i, o) === p))[0]
  if (!o) return failure('unknown-op', `${to} has no action ${p}`)
  if (o.input && !o.input.check(input)) return failure('invalid-input', `${p}: input does not fit ${o.input.type}`)
  const made = await live.instance(to)
  if (!made.ok) return made
  const ran = await within(() => made.value.get(p)!(input), live.timeoutMs, `${to} ${p}`)
  if (!ran.ok) { live.trace.emit({ type: 'failure', pod: to, reason: ran.fail.reason }); return ran }
  const r = ran.value
  if (!isNanoResult(r)) return failure('invalid-output', `${p}: returned something other than a NanoResult`)
  if (r.ok && o.output && !o.output.check(r.value)) return failure('invalid-output', `${p}: output does not fit ${o.output.type}`)
  return r
}

/** One message from `from` to `to`'s port `p`, in runtime `runtime`. A throwing policy denies. */
export async function send(live: Live, runtime: string, from: string, to: string, p: string, input: unknown): Promise<NanoResult<unknown>> {
  const { trace } = live, id = trace.id()
  trace.emit({ type: 'sent', id, runtime, from, to, port: p })
  let v
  try { v = (live.policies[runtime] ?? Policies.allowAll()).isAllowed(from, to, input) } catch (e) { v = { approved: false as const, reason: `policy threw: ${msg(e)}` } }
  if (!v.approved) { trace.emit({ type: 'denied', id, reason: v.reason }); return failure('denied', v.reason) }
  const t0 = performance.now()
  const r = await deliver(live, to, p, input)
  trace.emit({ type: 'delivered', id, result: r, ms: performance.now() - t0 })
  return r
}

/**
 * A client by op name from `from` to `to` in `runtime`. `gone()` is asked at each call, before anything is sent: a
 * reason makes the call `not-found`.
 */
export function client(live: Live, runtime: string, from: string, to: string, gone: () => string | undefined): Record<string, (input: unknown) => Promise<NanoResult<unknown>>> {
  const call = async (name: string, input: unknown): Promise<NanoResult<unknown>> => {
    const why = gone()
    if (why) return failure('not-found', why)
    const ports = (impl(live, to)?.provides ?? []).flatMap(i => Object.values(i.ops).filter(o => o.kind === 'action' && o.name === name).map(o => port(i, o)))
    if (ports.length === 0) return failure('unknown-op', `${to} has no action ${name}`)
    if (ports.length > 1) return failure('ambiguous', `${to}: ${name} is an action of more than one interface`)
    return send(live, runtime, from, to, ports[0]!, input)
  }
  // ponytail: any name reads as an op (a Proxy) except `then`, so awaiting a client is harmless; an op named `then` is unreachable.
  return new Proxy({}, { get: (_, name) => (typeof name === 'string' && name !== 'then' ? (input: unknown) => call(name, input) : undefined) })
}
