/**
 * A message and what follows from it. An action's successful result is an emission from its pod, as is an event it
 * publishes: delivered along every pipe from that pod and port in every runtime the pod is placed in (runtimes in
 * order, then pipes in order), then to every live `on` subscription to it (in the order made). Each delivery is its own
 * message, kept in `live.flying` until it settles; once the application is closing, nothing is delivered. The caller
 * of an action does not wait for its emission. And a client by op name over such messages.
 *
 *   await client(live, 'r', 'host', 'db', () => undefined).get('k')   // a call starting a chain; its result emitted
 *   await emit(live, 'db', 'acme.Store/saved', 'x')                  // a published event: one new chain
 */
import { port } from '../iface.ts'
import { failure, success, type NanoResult } from '../result.ts'
import { attempt, send, type Live } from './messages.ts'

type Chain = { id?: string; correlation?: string; cause?: string }

const fly = <T>(live: Live, p: Promise<T>): Promise<T> => {
  const done = () => { live.flying.delete(p) }
  live.flying.add(p)
  p.then(done, done)
  return p
}

/** An action message (a call or a pipe delivery), then the emission of its successful result, caused by it. */
async function act(live: Live, runtime: string, from: string, to: string, p: string, input: unknown, kind: 'call' | 'pipe', chain: Chain = {}) {
  const id = chain.id ?? live.trace.id(), correlation = chain.correlation ?? id
  const r = await send(live, runtime, from, to, p, input, { ...chain, kind, id, correlation })
  if (r.ok) void emit(live, to, p, r.value, { correlation, cause: id })
  return r
}

/**
 * `from`'s emission at port `port`. With no `chain` (a published event) it starts one: the first delivery's id is the
 * correlation of every delivery, none with a cause. Resolves once the pipe deliveries settle, not the `on` ones.
 */
export function emit(live: Live, from: string, port: string, data: unknown, chain?: Chain): Promise<unknown> {
  if (live.closed()) return Promise.resolve()
  let first: string | undefined
  const link = (): Chain => chain ?? (first ? { correlation: first } : { id: (first = live.trace.id()), correlation: first })
  const pipes = Object.entries(live.now().runtimes).filter(([, r]) => r.pods.includes(from)).flatMap(([runtime, r]) =>
    r.subscriptions.flatMap(s => s.kind === 'pipe' && s.from === from && s.source === port
      ? [fly(live, act(live, runtime, from, s.to, s.target, data, 'pipe', link()))] : []))
  for (const o of [...live.ons]) {
    if (o.from !== from || o.port !== port) continue
    const work = async () => { const r = await attempt(live, o.to, `${o.to} hearing ${port}`, () => o.fn(data)); return r.ok ? success(undefined) : r }
    fly(live, send(live, o.runtime, from, o.to, port, data, { kind: 'on', ...link(), work }))
  }
  return Promise.all(pipes)
}

/**
 * A client by op name from `from` to `to` in `runtime`. `gone()` is asked at each call, before anything is sent: a
 * Fail it gives is the call's result.
 */
export function client(live: Live, runtime: string, from: string, to: string, gone: () => NanoResult<never> | undefined): Record<string, (input: unknown) => Promise<NanoResult<unknown>>> {
  const call = async (name: string, input: unknown): Promise<NanoResult<unknown>> => {
    const why = gone()
    if (why) return why
    const provides = live.registry.implementation(live.now().pods[to]?.implementation ?? '')?.provides ?? []
    const ports = provides.flatMap(i => Object.values(i.ops).filter(o => o.kind === 'action' && o.name === name).map(o => port(i, o)))
    if (ports.length === 0) return failure('unknown-op', `${to} has no action ${name}`)
    if (ports.length > 1) return failure('ambiguous', `${to}: ${name} is an action of more than one interface`)
    return act(live, runtime, from, to, ports[0]!, input, 'call')
  }
  // ponytail: any name reads as an op (a Proxy) except `then`, so awaiting a client is harmless; an op named `then` is unreachable.
  return new Proxy({}, { get: (_, name) => (typeof name === 'string' && name !== 'then' ? (input: unknown) => call(name, input) : undefined) })
}
