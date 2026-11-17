/**
 * The frame's subscriptions, held by the host: `open` posts `on`/`view-on` with a fresh id, the host's `emission`s
 * for that id are heard, its `ended` ends it (a Fail throws from the iterable, or is a `warn` for a callback), and
 * ending it here posts `off`. The host connects asynchronously, so a refusal shows at the loop, not at the call.
 *
 *   const h = hearings(post)
 *   for await (const e of h.open(id => ({ type: 'on', id, pod: 'h', runtime: 'r', op: 't.H/said' }))) …
 *   h.close()   // every one ends done, and the host is told off
 */
import type { Fail, NanoResult } from '@pritzlaff/nano-core'
import type { Msg } from './protocol.ts'

type Held = { push(e: unknown): void; end(r: NanoResult<unknown>): void }

export function hearings(post: (m: Msg) => void) {
  const held = new Map<number, Held>()
  let n = 0

  function open<T>(msg: (id: number) => Msg, fn?: (e: T) => void | Promise<void>): (() => void) | AsyncIterable<T> {
    const id = ++n, queue: T[] = []
    let done = false, failed: Fail | undefined, wake: (() => void) | undefined, used = false
    const stop = () => { done = true; wake?.(); if (held.delete(id)) try { post({ type: 'off', id }) } catch { /* port gone */ } }
    held.set(id, {
      push: e => { if (fn) void Promise.resolve().then(() => fn(e as T)).catch(x => console.warn(`sandbox: a listener threw: ${x}`)); else { queue.push(e as T); wake?.() } },
      end: r => {
        held.delete(id); done = true
        if (!r.ok) { failed = r.fail; if (fn) post({ type: 'warn', reason: `${r.fail.type}: ${r.fail.reason}` }) }
        wake?.()
      },
    })
    post(msg(id))
    if (fn) return stop
    return { [Symbol.asyncIterator]() {
      if (used) throw new Error('iterable: iterate once; subscribe again for another')
      used = true
      return {
        async next() {
          while (!queue.length && !done) await new Promise<void>(r => { wake = r })
          if (queue.length) return { done: false as const, value: queue.shift()! }
          if (failed) throw Object.assign(new Error(`${failed.type}: ${failed.reason}`), { fail: failed })
          return { done: true as const, value: undefined }
        },
        async return() { stop(); return { done: true as const, value: undefined } },
      }
    } }
  }

  return {
    open,
    emission(id: number, e: unknown) { held.get(id)?.push(e) },
    ended(id: number, r: NanoResult<unknown>) { held.get(id)?.end(r) },
    /** Ends every one (done) and tells the host. */
    close() { for (const [id, h] of [...held]) { h.end({ ok: true, value: undefined }); try { post({ type: 'off', id }) } catch { /* port gone */ } } },
  }
}
