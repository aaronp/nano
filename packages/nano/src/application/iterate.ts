/**
 * An AsyncIterable over a listener. `ended(stop)` hands over the way the source ends it (called first, so a listener
 * dropped at once still ends); `listen(fn)` connects and gives the unsubscribe, which `return()` (a `break`) calls.
 *
 *   for await (const e of iterate(fn => on(op, fn), stop => …)) …   // values pushed by `fn`, in order, until ended
 */
export function iterate<T>(listen: (fn: (v: T) => void) => () => void, ended: (stop: () => void) => void): AsyncIterable<T> {
  return { [Symbol.asyncIterator]() {
    // ponytail: unbounded buffer, add backpressure when a slow consumer matters
    const queue: T[] = []
    let done = false, wake: (() => void) | undefined
    const stop = () => { done = true; wake?.() }
    ended(stop)
    const off = listen(v => { queue.push(v); wake?.() })
    return {
      async next() {
        while (!queue.length && !done) await new Promise<void>(r => { wake = r })
        return queue.length ? { done: false as const, value: queue.shift()! } : { done: true as const, value: undefined }
      },
      async return() { off(); stop(); return { done: true as const, value: undefined } },
    }
  } }
}
