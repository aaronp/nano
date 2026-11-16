import type { Fail } from '../result.ts'

/**
 * A once-only AsyncIterable over a listener, connected at its first iteration. `ended(stop)` hands over the way the source ends it (called first, so a listener
 * dropped at once still ends); `listen(fn)` connects and gives the unsubscribe, which `return()` (a `break`) calls.
 *
 *   for await (const e of iterate(fn => on(op, fn), stop => …)) …   // values pushed by `fn`, in order, until ended
 */
export function iterate<T>(listen: (fn: (v: T) => void) => () => void, ended: (stop: (fail?: Fail) => void) => void): AsyncIterable<T> {
  let used = false
  return { [Symbol.asyncIterator]() {
    if (used) throw new Error('iterable: iterate once; call on / subscribe again for another')
    used = true
    // ponytail: unbounded buffer, add backpressure when a slow consumer matters
    const queue: T[] = []
    let done = false, failed: Fail | undefined, wake: (() => void) | undefined
    const stop = (fail?: Fail) => { if (!done) failed = fail; done = true; wake?.() }
    ended(stop)
    const off = listen(v => { queue.push(v); wake?.() })
    return {
      async next() {
        while (!queue.length && !done) await new Promise<void>(r => { wake = r })
        if (queue.length) return { done: false as const, value: queue.shift()! }
        if (failed) throw Object.assign(new Error(`${failed.type}: ${failed.reason}`), { fail: failed })
        return { done: true as const, value: undefined }
      },
      async return() { off(); stop(); return { done: true as const, value: undefined } },
    }
  } }
}
