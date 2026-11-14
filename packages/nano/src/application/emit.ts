/**
 * Emissions: an event a pod published, or a successful result of one of its actions, delivered along every pipe from
 * that pod and port in every runtime the pod is placed in (runtimes in order, then pipes in order), then to every live
 * `on` subscription to it (in the order made). Each delivery is its own message, carrying the emission's chain, and is
 * kept in `live.flying` until it settles. Once the application is closing, nothing is delivered.
 *
 *   emit(live, 'db', 'acme.Store/save', 'db:x', { correlation: 'm1', cause: 'm1' })   // settles with the pipe deliveries
 */
import { success } from '../result.ts'
import { send, within, type Live } from './messages.ts'

/** A subscription made in code: `to` hears `from`'s port `port` in `runtime`, while `gone()` gives no reason. */
export type On = { runtime: string; from: string; port: string; to: string; gone(): unknown; fn(data: unknown): unknown }

const fly = (live: Live, p: Promise<unknown>) => {
  live.flying.add(p)
  const done = () => { live.flying.delete(p) }
  p.then(done, done)
  return p
}

/** Resolves once the pipe deliveries settle; `on` deliveries are not waited for. */
export function emit(live: Live, from: string, port: string, data: unknown, chain: { correlation?: string; cause?: string }): Promise<unknown> {
  if (live.closed()) return Promise.resolve()
  const pipes = Object.entries(live.now().runtimes).filter(([, r]) => r.pods.includes(from)).flatMap(([runtime, r]) =>
    r.subscriptions.flatMap(s => s.kind === 'pipe' && s.from === from && s.source === port
      ? [fly(live, send(live, runtime, from, s.to, s.target, data, { kind: 'pipe', ...chain }))] : []))
  for (const o of [...live.ons]) {
    if (o.from !== from || o.port !== port) continue
    if (o.gone()) { live.ons.delete(o); continue }
    const run = async () => {
      const r = await within(() => o.fn(data), live.timeoutMs, `${o.to} hearing ${port}`)
      if (!r.ok) live.trace.emit({ type: 'failure', pod: o.to, reason: r.fail.reason })
      return r.ok ? success(undefined) : r
    }
    fly(live, send(live, o.runtime, from, o.to, port, data, { kind: 'on', ...chain, run }))
  }
  return Promise.all(pipes)
}
