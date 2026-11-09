// Queues values and publishes them as one batch: after a quiet period, or at the latest after max wait.
import { Type } from 'typebox'
import { component, event, state } from '@composable/runes'

/** A debouncer: `enqueue` values, get them back as `flushed` arrays. */
export const Debounce = component('composable.bundle/debounce', () => {
  const s = state({ quiet: 300, maxWait: 1000, pending: 0 })
  const flushed = event(Type.Array(Type.Unknown()))
  let queue: unknown[] = [], quietTimer: Timer | undefined, maxTimer: Timer | undefined
  const flush = () => {
    clearTimeout(quietTimer); clearTimeout(maxTimer); maxTimer = undefined
    const batch = queue; queue = []; s.pending = 0
    if (batch.length) flushed(batch)
  }
  return {
    get quiet() { return s.quiet }, get maxWait() { return s.maxWait }, get pending() { return s.pending },
    flushed,
    setQuiet: (ms: number) => { s.quiet = ms },
    setMaxWait: (ms: number) => { s.maxWait = ms },
    enqueue: (x: unknown) => {
      queue.push(x); s.pending = queue.length
      clearTimeout(quietTimer); quietTimer = setTimeout(flush, s.quiet)
      maxTimer ??= setTimeout(flush, s.maxWait)
    },
  }
}, { setQuiet: Type.Number({ minimum: 0 }), setMaxWait: Type.Number({ minimum: 0 }) })
