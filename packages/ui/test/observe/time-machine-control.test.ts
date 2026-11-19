// The time machine: see time-machine-setup.ts for the fake ticker and the entry source.
import { expect, test } from 'bun:test'
import { timeMachine, type Frame } from '../../src/observe/time-machine.ts'
import { fakeTicker, source, sent } from './time-machine-setup.ts'

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
