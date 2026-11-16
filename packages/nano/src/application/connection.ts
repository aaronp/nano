/**
 * Subscribing is a message. `connect` sends `subscribe` from the On's owner (`to`: a pod or 'host') to its source pod
 * in its runtime: `delivered` once live, or `denied` when the runtime's policy refuses (then nothing is added). The
 * On's `end`, which every way an On ends goes through, sends `unsubscribe` (caused by the subscribe): `delivered` with
 * `success` when stopped, or with the `Fail` that ended it (the policy refusing it on apply).
 *
 *   const c = connect(live, { runtime, from: 'store', port, to: 'host', gone, fn }, fail => …)   // c.ok: c.value is the live On
 */
import { failure, success, type Fail, type NanoResult } from '../result.ts'
import { refusal, type Live, type On } from './messages.ts'

export function connect(live: Live, w: Omit<On, 'end'>, ended: (fail?: Fail) => void = () => {}): NanoResult<On> {
  const { trace } = live, id = trace.id()
  const say = (kind: 'subscribe' | 'unsubscribe', mid: string) =>
    trace.emit({ type: 'sent', id: mid, runtime: w.runtime, kind, from: w.to, to: w.from, port: w.port, correlation: id, ...(mid !== id && { cause: id }) })
  say('subscribe', id)
  const why = refusal(live, { runtime: w.runtime, kind: 'subscribe', from: w.to, to: w.from, port: w.port })
  if (why !== undefined) { trace.emit({ type: 'denied', id, reason: why }); return failure('denied', why) }
  trace.emit({ type: 'delivered', id, result: success(undefined), ms: 0 })
  let open = true
  const key = `${w.from} ${w.port}`
  const on: On = { ...w, end(fail) {
    if (!open) return
    open = false
    live.listeners.ons.delete(on)
    const set = live.listeners.heard.get(key)
    if (set?.delete(on) && set.size === 0) live.listeners.heard.delete(key)
    const u = trace.id()
    say('unsubscribe', u)
    trace.emit({ type: 'delivered', id: u, result: fail ? { ok: false, fail } : success(undefined), ms: 0 })
    ended(fail)
  } }
  live.listeners.ons.add(on)
  const set = live.listeners.heard.get(key)
  if (set) set.add(on); else live.listeners.heard.set(key, new Set([on]))
  return success(on)
}
