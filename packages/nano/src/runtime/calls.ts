/**
 * Calls: one message through a runtime — on its stream as `sent`, then `delivered` (result, ms) or `denied` (reason);
 * policed; the callee invoked with this runtime's context; booked on its subscription. And a host's calls into a pod.
 *
 *   await send(rt, 's1', 'acme/app/main#0', 'acme/db/mem#0', port, input)   // a verb's call over subscription s1
 *   await hostCall(rt, 'acme/db/mem#0').get('k')                             // from 'host', over no subscription
 */
import { portKey } from '../iface.ts'
import type { Pod } from '../pod.ts'
import type { Policy } from '../policy.ts'
import { failure, type NanoResult } from '../result.ts'
import type { Registry } from '../registry.ts'
import type { Tracer } from './trace.ts'
import { contextFor, type Wiring } from './verbs.ts'

export type Book = { calls: number; last?: NanoResult<unknown> }

/** What a message needs of the runtime it travels through, read live. */
type Through = {
  readonly policy: Policy
  readonly books: Map<string, Book>
  readonly wiring: Wiring
  pod(coord: string): Pod | undefined
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * One message over subscription `sid` (none for a host call, `from` 'host'). A denied message is not delivered and not
 * counted; one whose subscription went meanwhile is never sent. A throw or timeout of the callee itself is a `failure` too.
 */
export async function send(rt: Through, sid: string | undefined, from: string, to: string, port: string, input: unknown): Promise<NanoResult<unknown>> {
  const { trace } = rt.wiring
  const sub = sid === undefined ? undefined : rt.wiring.subscriptions().find(s => s.id === sid)
  if (sid !== undefined && !sub) return failure('not-found', `no subscription ${sid} in ${rt.wiring.id}`)
  const id = trace.message()
  trace.emit({ type: 'sent', id, ...(sid !== undefined && { subscription: sid }), from, to, port, kind: sub?.kind ?? 'call' })
  const deny = (reason: string) => { trace.emit({ type: 'denied', id, reason }); return failure('denied', reason) }
  let v
  try { v = rt.policy.isAllowed(from, to, input) } catch (e) {
    trace.emit({ type: 'failure', coord: from, reason: `policy threw: ${msg(e)}` })
    return deny(`policy threw: ${msg(e)}`)
  }
  if (!v.approved) return deny(v.reason)
  const pod = rt.pod(to)
  const t0 = performance.now()
  const r = pod ? await pod.invoke(contextFor(rt.wiring, to, pod), port, input) : failure('not-found', `${to} is not registered in ${rt.wiring.id}`)
  // The callee's own throw or timeout, not one it passed on: pod.ts prefixes its own fails' reasons with `<implementation>: `.
  if (pod && !r.ok && (r.fail.type === 'threw' || r.fail.type === 'timeout') && r.fail.reason.startsWith(`${pod.implementation}: `))
    trace.emit({ type: 'failure', coord: to, reason: r.fail.reason })
  trace.emit({ type: 'delivered', id, result: r, ms: performance.now() - t0 })
  // Book only on the very subscription the call went over: unsubscribed, retargeted or replaced meanwhile, it is off the books.
  if (sub && pod && rt.wiring.subscriptions().includes(sub)) rt.books.set(sub.id, { calls: (rt.books.get(sub.id)?.calls ?? 0) + 1, last: r })
  return r
}

/** The ports of `name` among the pod's interfaces (an op name in two is ambiguous). */
const portsOf = (registry: Registry, pod: Pod, name: string) =>
  (registry.implementation(pod.implementation)?.provides ?? []).flatMap(i =>
    Object.values(i.ops).filter(o => o.name === name && o.kind !== 'source').map(o => portKey(i.coord, o.coord)))

/** `rt.call(coord).<op>(input)`: the pod is looked up at each call, so one unregistered meanwhile is `not-found`. */
export function hostCall(rt: Through, coord: string): Record<string, (input: unknown) => Promise<NanoResult<unknown>>> {
  const call = async (name: string, input: unknown): Promise<NanoResult<unknown>> => {
    const pod = rt.pod(coord)
    if (!pod) return failure('not-found', `${coord} is not registered in ${rt.wiring.id}`)
    const ports = portsOf(rt.wiring.registry, pod, name)
    if (ports.length === 0) return failure('unknown-op', `${coord} has no op ${name}`)
    if (ports.length > 1) return failure('ambiguous', `${coord}: ${name} is an op of more than one interface`)
    return send(rt, undefined, 'host', coord, ports[0]!, input)
  }
  // ponytail: any op name reads as a function (a Proxy), except `then`, so awaiting the record is harmless; an op named `then` is unreachable here.
  return new Proxy({}, { get: (_, name) => (typeof name === 'string' && name !== 'then' ? (input: unknown) => call(name, input) : undefined) })
}
