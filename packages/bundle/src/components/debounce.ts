// Queues values and publishes them as one batch: after a quiet period, or at the latest after max wait.
import { Type } from 'typebox'
import { component, event, state } from '@composable/runes'

/** A queued value and when it arrived (ms since the epoch). */
export type Queued = { value: unknown; at: number }

/** A debouncer: `enqueue` values, get them back as `flushed` arrays. `queued` shows what is waiting, and since when. */
export const Debounce = component('composable.bundle/debounce', () => {
  const s = state({ quiet: 300, maxWait: 1000, queued: [] as Queued[] })
  const flushed = event(Type.Array(Type.Unknown()))
  let quietTimer: Timer | undefined, maxTimer: Timer | undefined
  const flush = () => {
    clearTimeout(quietTimer); clearTimeout(maxTimer); maxTimer = undefined
    const batch = s.queued.map(q => q.value); s.queued = []
    if (batch.length) flushed(batch)
  }
  return {
    get quiet() { return s.quiet }, get maxWait() { return s.maxWait },
    get pending() { return s.queued.length }, get queued() { return s.queued },
    flushed,
    setQuiet: (ms: number) => { s.quiet = ms },
    setMaxWait: (ms: number) => { s.maxWait = ms },
    enqueue: (x: unknown) => {
      s.queued.push({ value: x, at: Date.now() })
      clearTimeout(quietTimer); quietTimer = setTimeout(flush, s.quiet)
      maxTimer ??= setTimeout(flush, s.maxWait)
    },
  }
}, { setQuiet: Type.Number({ minimum: 0 }), setMaxWait: Type.Number({ minimum: 0 }) })
