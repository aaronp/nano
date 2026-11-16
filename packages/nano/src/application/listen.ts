/**
 * `runtimeView.listen`: the one stream (`trace`) filtered to runtime `runtime`: its `sent` messages and their
 * `delivered`/`denied`, `applied` narrowed to the pods placed there (now or before), and the lifecycle of those pods, even as `apply` removes
 * them. Warnings, and a `denied` that was never `sent` (a refused subscribe), are the operator's: `app.listen` only.
 *
 *   const off = listen(live, 'front', e => …)   // nothing from another runtime
 */
import type { Live } from './messages.ts'
import type { AppEvent } from './stream.ts'

export function listen(live: Live, runtime: string, fn: (e: AppEvent) => void): () => void {
  const mine = new Set<string>()   // ids sent here, not yet answered
  const seen = new Set<string>()   // ponytail: pods ever placed here, never pruned
  const refresh = () => { for (const p of live.now().runtimes[runtime]?.pods ?? []) seen.add(p) }
  refresh()
  return live.trace.listen(e => {
    refresh()
    if (e.type === 'sent') { if (e.runtime === runtime) { mine.add(e.id); fn(e) } }
    else if (e.type === 'delivered' || e.type === 'denied') { if (mine.delete(e.id)) fn(e) }
    else if (e.type === 'applied') {
      const keep = (l: string[]) => l.filter(p => seen.has(p))
      const n = { added: keep(e.added), removed: keep(e.removed), changed: keep(e.changed), rewired: keep(e.rewired) }
      if (Object.values(n).some(l => l.length)) fn({ type: 'applied', ...n })
    }
    else if (e.type !== 'warning' && e.pod !== undefined && seen.has(e.pod)) fn(e)
  })
}
