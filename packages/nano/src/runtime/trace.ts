/**
 * The runtime's one observable stream: lifecycle, wiring, messages (sent, then delivered or denied) and problems, in order.
 *
 *   const t = tracer()
 *   const off = t.listen(e => { if (e.type === 'denied') log(e.id, e.reason) })
 *   t.emit({ type: 'warning', reason: 'client: member s skipped: no runtime nowhere' })   // a throwing listener is swallowed
 *   t.message()   // 'm1', then 'm2', …: this runtime's next message id
 */
import type { NanoResult } from '../result.ts'
import type { InstanceState } from './pods.ts'
import type { Status, SubscriptionData } from './subscriptions.ts'

export type RuntimeEvent =
  // lifecycle
  | { type: 'pod-created'; pod: string; implementation: string }
  | { type: 'pod-removed'; pod: string }
  | { type: 'pod-swapped'; pod: string; from: string; to: string }
  | { type: 'instance'; coord: string; state: InstanceState; reason?: string }
  // wiring
  | { type: 'subscription-set'; subscription: SubscriptionData }
  | { type: 'subscription-removed'; id: string; reason: 'unsubscribed' | 'cascade' }
  | { type: 'status'; id: string; status: Status }
  // messages: `sent`, then exactly one of `delivered` or `denied` with the same id
  | { type: 'sent'; id: string; subscription?: string; from: string; to: string; port: string; kind: 'call' | 'event' }
  | { type: 'delivered'; id: string; result: NanoResult<unknown>; ms: number }
  | { type: 'denied'; id: string; reason: string }
  // problems
  | { type: 'failure'; coord?: string; reason: string }
  | { type: 'warning'; reason: string }

export type Tracer = {
  emit(e: RuntimeEvent): void
  listen(fn: (e: RuntimeEvent) => void): () => void
  message(): string
}

export function tracer(): Tracer {
  const listeners = new Set<(e: RuntimeEvent) => void>()
  let n = 0
  return {
    emit(e) { for (const fn of [...listeners]) try { fn(e) } catch { /* a listener must never break the runtime */ } },
    listen(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    message: () => `m${++n}`,
  }
}
