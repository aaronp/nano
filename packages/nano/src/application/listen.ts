/**
 * `runtimeView.listen`: the one stream (`trace`) filtered to runtime `runtime`: its `sent` messages and their
 * `delivered`/`denied`, `applied`, and the lifecycle of the pods placed there now. Warnings are the operator's.
 *
 *   const off = listen(live, 'front', e => …)   // nothing from another runtime
 */
import type { Live } from './messages.ts'
import type { AppEvent } from './stream.ts'

export function listen(live: Live, runtime: string, fn: (e: AppEvent) => void): () => void {
  const mine = new Set<string>()   // ids sent here, not yet answered
  return live.trace.listen(e => {
    if (e.type === 'sent') { if (e.runtime === runtime) { mine.add(e.id); fn(e) } }
    else if (e.type === 'delivered' || e.type === 'denied') { if (mine.delete(e.id)) fn(e) }
    else if (e.type === 'applied') fn(e)
    else if (e.type !== 'warning' && e.pod !== undefined && live.now().runtimes[runtime]?.pods.includes(e.pod)) fn(e)
  })
}
