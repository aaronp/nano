import { expect, test } from 'bun:test'
import type { Entry, Recorded } from '../../src/observe/entry.ts'
import { memoryStore } from '../../src/observe/memory-store.ts'
import { record } from '../../src/observe/record.ts'
import { timeMachine, type Frame, type Ticker } from '../../src/observe/time-machine.ts'
import { settle, typingSim } from './typing.ts'

/** A ticker run by hand: `run(ms)` moves its clock on and runs the frame waiting, if any. */
function fakeTicker(start = 0) {
  let now = start
  let waiting: (() => void) | undefined
  const ticker: Ticker = { now: () => now, frame: fn => { waiting = fn; return () => { if (waiting === fn) waiting = undefined } } }
  return { ticker, waiting: () => waiting !== undefined, run(ms: number) { now += ms; const fn = waiting; waiting = undefined; fn?.() } }
}

/** A store with a listen, filled by hand. */
function source() {
  const store = memoryStore()
  const heard = new Set<(e: Entry) => void>()
  let seq = 0
  const push = (at: number, event: Recorded) => { const e = { seq: ++seq, at, event }; store.append(e); for (const fn of heard) fn(e) }
  return { store, listen: (fn: (e: Entry) => void) => { heard.add(fn); return () => { heard.delete(fn) } }, push, heard }
}
const sent = (id: string): Recorded => ({ type: 'sent', id, runtime: 'main', kind: 'call', from: 'host', to: 'input', port: 'p', correlation: id })
const ids = (f: Frame) => f.inFlight.map(x => x.message.sent.id)

test('live follows new entries and emits a frame each', async () => {
  const app = await typingSim()
  const store = memoryStore()
  const rec = await record(app, store)
  const tm = await timeMachine({ store, listen: rec.listen }, { ticker: fakeTicker().ticker })
  const frames: Frame[] = []
  tm.subscribe(f => frames.push(f))
  expect(tm.mode).toBe('live')
  await app.call('main', 'input').change('h'); await settle()
  const entries = await store.range()
  expect(frames.length).toBe(entries.length - 1)   // every entry after the deployment
  expect(tm.cursor).toBe(entries.at(-1)!.at)
  const last = frames.at(-1)!
  expect(last.at).toBe(last.recent.at(-1)!)
  const m = last.recent.find(m => m.sent.from === 'host' && m.sent.to === 'input')!
  expect(m.outcome?.type).toBe('delivered')   // its outcome arrived in a later entry
  tm.close(); rec.stop(); await app.close()
})

test('seek(t) gives the messages in flight with progress', async () => {
  const s = source()
  s.push(1000, sent('a')); s.push(1500, sent('b')); s.push(1500, { type: 'delivered', id: 'b', ok: true, result: '1', ms: 0 })
  const tm = await timeMachine(s, { ticker: fakeTicker().ticker })
  let f!: Frame
  tm.subscribe(x => { f = x })
  tm.seek(1300)
  expect(tm.mode).toBe('paused')
  expect(f.t).toBe(1300)
  expect(f.inFlight).toEqual([{ message: f.recent[0]!, progress: 0.5 }])
  expect(f.at?.sent.id).toBe('a')
  tm.seek(1550)
  expect(ids(f)).toEqual(['a', 'b'])
  expect(f.recent.map(m => m.sent.id)).toEqual(['a', 'b'])
  expect(f.recent[1]!.outcome?.type).toBe('delivered')
  tm.setSpeed(1 / 30); tm.seek(1300)   // speed moves the cursor, never the window
  expect(f.inFlight).toEqual([{ message: f.recent[0]!, progress: 0.5 }])
  tm.close()
})

test('step visits messages sharing an at in seq order', async () => {
  const s = source()
  s.push(10, sent('a')); s.push(20, sent('b')); s.push(20, sent('c')); s.push(30, sent('d'))
  const tm = await timeMachine(s, { ticker: fakeTicker().ticker })
  const seen: string[] = []
  tm.subscribe(f => seen.push(`${f.t}:${f.at?.sent.id}:${f.recent.at(-1)?.sent.id}`))
  tm.seek(10)
  tm.step(1); tm.step(1); tm.step(1); tm.step(1)
  tm.step(-1); tm.step(-1)
  expect(seen).toEqual(['10:a:a', '20:b:b', '20:c:c', '30:d:d', '30:d:d', '20:c:c', '20:b:b'])
  expect(tm.mode).toBe('paused')
  tm.close()
})

test('playing moves at speed × real time and jumps idle gaps over 1 s', async () => {
  const s = source()
  s.push(1000, sent('a')); s.push(1200, sent('b')); s.push(5000, sent('c')); s.push(9000, sent('d'))
  const k = fakeTicker()
  const tm = await timeMachine(s, { ticker: k.ticker })
  tm.seek(1000)
  tm.setSpeed(0.5)
  tm.play()
  expect(tm.mode).toBe('playing')
  k.run(100)
  expect(tm.cursor).toBe(1050)
  k.run(200)
  expect(tm.cursor).toBe(1150)
  k.run(1000)   // to 1650: b's window (1200 to 1800) still covers it
  expect(tm.cursor).toBe(1650)
  k.run(1600)   // to 2450: nothing in flight, c is 2550 ms away: jump to c
  expect(tm.cursor).toBe(5000)
  tm.close()
})

test('playing catches up and becomes live', async () => {
  const s = source()
  s.push(1000, sent('a')); s.push(1300, sent('b'))
  const k = fakeTicker()
  const tm = await timeMachine(s, { ticker: k.ticker })
  tm.seek(1000); tm.play()
  k.run(200)
  expect(tm.mode).toBe('playing')
  k.run(200)
  expect(tm.mode).toBe('live')
  expect(tm.cursor).toBe(1300)
  s.push(1400, sent('c'))
  expect(tm.cursor).toBe(1400)
  tm.close()
})

test('pause stays put while recording continues; span grows', async () => {
  const s = source()
  s.push(1000, sent('a'))
  const k = fakeTicker()
  const tm = await timeMachine(s, { ticker: k.ticker })
  expect(tm.span).toEqual({ from: 1000, to: 1000 })
  tm.seek(1000); tm.play(); tm.pause()
  expect(k.waiting()).toBe(false)
  let frames = 0
  tm.subscribe(() => frames++)
  s.push(2000, sent('b')); s.push(3000, { type: 'built', pod: 'x' })
  expect(tm.mode).toBe('paused')
  expect(tm.cursor).toBe(1000)
  expect(tm.span).toEqual({ from: 1000, to: 3000 })
  expect(frames).toBe(0)
  tm.live()
  expect(tm.cursor).toBe(3000)
  tm.close()
})

test('close stops listening and ticking', async () => {
  const s = source()
  s.push(1000, sent('a')); s.push(5000, sent('b'))
  const k = fakeTicker()
  const tm = await timeMachine(s, { ticker: k.ticker })
  let frames = 0
  tm.subscribe(() => frames++)
  tm.seek(1000); tm.play()
  frames = 0
  tm.close()
  expect(s.heard.size).toBe(0)
  expect(k.waiting()).toBe(false)
  s.push(6000, sent('c')); k.run(100)
  expect(frames).toBe(0)
})

test('live ticks while a message is in flight, at now', async () => {
  const s = source()
  const k = fakeTicker(10000)
  const tm = await timeMachine(s, { ticker: k.ticker })
  const frames: Frame[] = []
  tm.subscribe(f => frames.push(f))
  s.push(9700, sent('a'))   // stamped 300 ms ago
  k.run(0)
  expect(frames.at(-1)!.t).toBe(10000)
  expect(frames.at(-1)!.inFlight.map(x => x.progress)).toEqual([0.5])
  k.run(200)
  expect(frames.at(-1)!.inFlight[0]!.progress).toBeCloseTo(500 / 600)
  k.run(200)   // landed: one last frame, empty, and no more ticking
  expect(frames.at(-1)!.inFlight).toEqual([])
  expect(k.waiting()).toBe(false)
  const n = frames.length
  k.run(100)
  expect(frames.length).toBe(n)
  tm.close()
})

test('setSpeed accepts only the known speeds', async () => {
  const tm = await timeMachine(source(), { ticker: fakeTicker().ticker })
  for (const s of [1 / 30, 1 / 10, 1 / 4, 1 / 2, 1, 2]) { tm.setSpeed(s); expect(tm.speed).toBe(s) }
  tm.setSpeed(0.0333333333333)
  expect(tm.speed).toBe(1 / 30)
  expect(() => tm.setSpeed(3)).toThrow(RangeError)
  expect(() => tm.setSpeed(0)).toThrow(RangeError)
  expect(tm.speed).toBe(1 / 30)
  tm.close()
})
