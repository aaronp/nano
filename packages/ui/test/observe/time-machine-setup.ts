import type { Entry, Recorded } from '../../src/observe/entry.ts'
import { memoryStore } from '../../src/observe/memory-store.ts'
import { type Frame, type Ticker } from '../../src/observe/time-machine.ts'

/** A ticker run by hand: `run(ms)` moves its clock on and runs the frame waiting, if any. */
export function fakeTicker(start = 0) {
  let now = start
  let waiting: (() => void) | undefined
  const ticker: Ticker = { now: () => now, frame: fn => { waiting = fn; return () => { if (waiting === fn) waiting = undefined } } }
  return { ticker, waiting: () => waiting !== undefined, run(ms: number) { now += ms; const fn = waiting; waiting = undefined; fn?.() } }
}

/** A store with a listen, filled by hand. */
export function source() {
  const store = memoryStore()
  const heard = new Set<(e: Entry) => void>()
  let seq = 0
  const push = (at: number, event: Recorded) => { const e = { seq: ++seq, at, event }; store.append(e); for (const fn of heard) fn(e) }
  return { store, listen: (fn: (e: Entry) => void) => { heard.add(fn); return () => { heard.delete(fn) } }, push, heard }
}
export const sent = (id: string): Recorded => ({ type: 'sent', id, runtime: 'main', kind: 'call', from: 'host', to: 'input', port: 'p', correlation: id })
export const ids = (f: Frame) => f.inFlight.map(x => x.message.sent.id)
