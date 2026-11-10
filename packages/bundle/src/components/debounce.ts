// Queues values and publishes them as one batch: after a quiet period, or at the latest after max wait.
import { Type } from 'typebox'
import { component, event, state } from '@pritzlaff/nano-runes'

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
}, {
  quiet: Type.Number({ description: 'How long, in ms, the queue must be quiet before it flushes', examples: [300] }),
  maxWait: Type.Number({ description: 'The longest, in ms, a value waits before a flush', examples: [1000] }),
  pending: Type.Number({ description: 'How many values are waiting', examples: [3] }),
  queued: Type.Array(Type.Object({ value: Type.Unknown({ description: 'The value' }), at: Type.Number({ description: 'When it arrived, ms since the epoch' }) }),
    { description: 'The waiting values, oldest first' }),
  flushed: Type.Array(Type.Unknown(), { description: 'A batch of queued values, oldest first', examples: [[1, 2, 3]] }),
  setQuiet: { in: Type.Number({ minimum: 0, description: 'ms', examples: [300] }), description: 'Sets the quiet period' },
  setMaxWait: { in: Type.Number({ minimum: 0, description: 'ms', examples: [1000] }), description: 'Sets the longest wait' },
  enqueue: { in: Type.Unknown({ description: 'Any value', examples: [42] }), description: 'Queues a value for the next batch' },
}, { description: 'Queues values and publishes them as one batch, after a quiet period or at most max wait' })
