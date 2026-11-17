/**
 * Messages: one message in one runtime — `sent` (with its kind and chain), policed, its input checked, the target built
 * or reused, run with the timeout, its output checked, then `delivered` (or `denied`). What follows from a message
 * (emissions) is `emit.ts`'s.
 *
 *   await send(live, 'r', 'host', 'db', 'acme.KV/get', 'k')   // NanoResult<unknown>; a call starting a chain
 *   await attempt(live, 'db', 'closing db', fn)               // fn within the timeout; a throw or timeout a `failure`
 */
import type { AppDeployment } from '../deployment.ts'
import type { Handler, Implementation } from '../implementation.ts'
import type { Pod } from '../pod.ts'
import type { Ask, Policy } from '../policy.ts'
import type { Registry } from '../registry.ts'
import type { NanoContext } from '../context.ts'
import { opAt } from '../runtime.ts'
import { lookup } from './lookup.ts'
import { failure, isNanoResult, success, type Fail, type NanoResult } from '../result.ts'
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
  /** The live listeners, in the order made: `on` subscriptions (a pod's, or the host's; `heard` the same by `${from} ${port}`, what `emit` reads) and pod-change listeners (`ctx.addOnPodChangeListener`). */
  readonly listeners: { ons: Set<On>; heard: Map<string, Set<On>>; podChanges: Set<{ pod: string; fn: Parameters<NanoContext['addOnPodChangeListener']>[0] }> }
  /** Deliveries under way, so `close()` can let them settle. */
  readonly flying: Set<Promise<unknown>>
  /** Whether `close()` has been called: nothing new is delivered. */
  closed(): boolean
  /** The host's stand-in implementation for a pod whose isolation isn't 'host'. */
  readonly isolate?: (name: string, pod: Pod) => Implementation
}

/** A subscription made in code: `to` (a pod, or 'host') hears pod `from`'s port `port` in `runtime`, while `gone()` gives nothing. `end(fail?)` ends it: sends `unsubscribe` and ends its iteration (`connection.ts`). */
export type On = { runtime: string; from: string; port: string; to: string; gone(): unknown; fn(e: { input?: unknown; output: unknown }): unknown; end(fail?: Fail): void }

/** A message's kind, its chain (`correlation`, `cause`), its id if already taken, and its `work` if not an action. */
type How = { kind: 'call' | 'pipe' | 'on'; id?: string; correlation?: string; cause?: string; work?: () => Promise<NanoResult<unknown>> }

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

/** `work()` within the timeout, as `pod`'s: a throw or a timeout is also a `failure` on the stream. */
export async function attempt<T>(live: Live, pod: string, what: string, work: () => T | Promise<T>): Promise<NanoResult<T>> {
  const r = await within(work, live.timeoutMs, what)
  if (!r.ok) live.trace.emit({ type: 'failure', pod, reason: r.fail.reason })
  return r
}

/** The implementation of `pod` in the deployment now, if it has one. */
export const impl = (live: Live, pod: string) => live.registry.implementation(live.now().pods[pod]?.implementation ?? '')
/** Every runtime `pod` is placed in, as [id, runtime deployment], in order. */
export const placedIn = (live: Live, pod: string) => { const d = live.now(); return (lookup(d).placedIn.get(pod) ?? []).map(id => [id, d.runtimes[id]!] as const) }
const action = (i: Implementation | undefined, p: string) => { const o = i && opAt(i, p); return o?.kind === 'action' ? o : undefined }

/** Why the policy of `ask.runtime` in `d` (the deployment now, or the one `apply` brings) refuses `ask`, or undefined. A throw, a Promise or no verdict refuses. */
export function refusal(live: Live, ask: Omit<Ask, 'outside'>, d = live.now()): string | undefined {
  const l = lookup(d)   // as it is in `d`, so `apply` changes it
  const policy = Object.hasOwn(live.policies, ask.runtime) ? live.policies[ask.runtime]! : l.policy(ask.runtime)
  try {
    const outside = ask.from === 'host' || !l.placed.get(ask.runtime)?.has(ask.from)
    const v = policy.isAllowed({ ...ask, outside }) as { approved?: unknown; reason?: unknown; then?: unknown } | undefined
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
  if (asked.input && !asked.input.check(input)) return failure('invalid-input', `${p}: input does not fit ${asked.input.label ?? 'its schema'}`)
  const made = await live.instance(to)
  if (!made.ok) return made
  // The op as the build knows it: an apply may have changed the pod while this build was under way.
  const o = action(made.value.implementation, p), h = made.value.handlers.get(p)
  if (!o || !h) return failure('unknown-op', `${to} has no action ${p}`)
  if (o.input && !o.input.check(input)) return failure('invalid-input', `${p}: input does not fit ${o.input.label ?? 'its schema'}`)
  const ran = await attempt(live, to, `${to} ${p}`, () => h(input))
  if (!ran.ok) return ran
  const r = ran.value
  if (!isNanoResult(r)) return failure('invalid-output', `${p}: returned something other than a NanoResult`)
  if (r.ok && o.output && !o.output.check(r.value)) return failure('invalid-output', `${p}: output does not fit ${o.output.label ?? 'its schema'}`)
  return r
}

/**
 * One message from `from` to `to`'s port `p`, in runtime `runtime`: `sent` (as `how.id`, or a new id), policed by
 * `refusal`, carried by `how.work` (by default the action at `p`), then `delivered`. With no `correlation` it starts a
 * chain. It sends exactly this one message.
 */
export async function send(live: Live, runtime: string, from: string, to: string, p: string, input: unknown, how: How = { kind: 'call' }): Promise<NanoResult<unknown>> {
  const { trace } = live, { kind, id = trace.id(), cause, work } = how, correlation = how.correlation ?? id
  trace.emit({ type: 'sent', id, runtime, kind, from, to, port: p, correlation, ...(cause !== undefined && { cause }) })
  const reason = refusal(live, { runtime, kind, from, to, port: p, data: input })
  if (reason !== undefined) { trace.emit({ type: 'denied', id, reason }); return failure('denied', reason) }
  const t0 = performance.now()
  const r = await (work ? work() : deliver(live, to, p, input)).catch(e => failure('invalid-input', `${p}: unreadable input: ${msg(e)}`))
  trace.emit({ type: 'delivered', id, result: r, ms: performance.now() - t0 })
  return r
}
