/**
 * The application's one stream: builds, closes, restarts, changes, messages (`sent`, then `delivered` or `denied`) and problems,
 * in order, synchronously. A `sent` names its kind and its chain: `correlation` is the first message's id, `cause` the
 * message that led to it. A throwing listener is swallowed.
 *
 *   const s = stream()
 *   const off = s.listen(e => { if (e.type === 'denied') log(e.id, e.reason) })
 *   s.emit({ type: 'warning', reason: '…' }); s.id()   // 'm1', then 'm2', …
 */
import type { NanoContext } from '../context.ts'
import type { NanoResult } from '../result.ts'

type Reason = Parameters<Parameters<NanoContext['addOnCloseListener']>[0]>[0]['reason']

export type AppEvent =
  | { type: 'built'; pod: string }
  | { type: 'closed'; pod: string; reason: Reason }
  | { type: 'restarted'; pod: string }
  | { type: 'applied'; caller: string; added: string[]; removed: string[]; changed: string[]; rewired: string[] }
  | { type: 'sent'; id: string; runtime: string; kind: 'call' | 'pipe' | 'on' | 'subscribe' | 'unsubscribe'; from: string; to: string; port: string; correlation: string; cause?: string; input?: unknown }
  | { type: 'delivered'; id: string; result: NanoResult<unknown>; ms: number }
  | { type: 'denied'; id: string; reason: string }
  | { type: 'failure'; pod?: string; reason: string }
  | { type: 'warning'; reason: string }

export function stream() {
  const listeners = new Set<(e: AppEvent) => void>()
  let n = 0
  return {
    emit(e: AppEvent) { for (const fn of [...listeners]) try { fn(e) } catch { /* a listener never breaks the application */ } },
    listen(fn: (e: AppEvent) => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    id: () => `m${++n}`,
  }
}
