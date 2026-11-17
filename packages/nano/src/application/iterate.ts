import { thrown } from '../plain.ts'
import type { Fail } from '../result.ts'

/**
 * The AsyncIterable form of a subscription (`on(op)`, `subscribe(op)` with no callback). Its behaviour, as a caller sees it:
 * - **It connects when it is made**, exactly like the callback form: it hears every emission from that line on, and a
 *   refusal or a missing source throws there (from `listen`), not at the loop.
 * - **It is iterated once.** A second `for await` over the same iterable throws; subscribe again for another.
 * - **It ends in one of two ways.** `done` when it simply stops (the loop's `break`, the build or the application
 *   closing, `apply` removing its source); or, after yielding what it had already received, by throwing an `Error`
 *   carrying the `Fail` that ended it (a policy refusing it on a later `apply`).
 * - **It never ends by itself while nobody iterates it**: an iterable made and not looped over keeps its listener
 *   until it is ended as above.
 *
 * `ended(stop)` hands over the way nano ends it (before connecting, so a listener dropped at once still ends);
 * `listen(fn)` connects and gives the unsubscribe that `break` calls.
 *
 *   for await (const e of iterate(fn => on(op, fn), stop => …)) …   // values pushed by `fn`, in order, until ended
 */
export function iterate<T>(listen: (fn: (v: T) => void) => () => void, ended: (stop: (fail?: Fail) => void) => void): AsyncIterable<T> {
  // ponytail: unbounded buffer for a slow reader; backpressure is decided with the performance work
  const queue: T[] = []
  let done = false, failed: Fail | undefined, wake: (() => void) | undefined, used = false
  const stop = (fail?: Fail) => { if (!done) failed = fail; done = true; wake?.() }
  ended(stop)
  const off = listen(v => { queue.push(v); wake?.() })
  return { [Symbol.asyncIterator]() {
    if (used) throw new Error('iterable: iterate once; subscribe again for another')
    used = true
    return {
      async next() {
        while (!queue.length && !done) await new Promise<void>(r => { wake = r })
        if (queue.length) return { done: false as const, value: queue.shift()! }
        if (failed) throw thrown(failed)
        return { done: true as const, value: undefined }
      },
      async return() { off(); stop(); return { done: true as const, value: undefined } },
    }
  } }
}
