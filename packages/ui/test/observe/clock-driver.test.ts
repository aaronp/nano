import { expect, test } from 'bun:test'
import { Registry, type Application } from '@pritzlaff/nano-core'
import uiProvider from '../../src/index.ts'
import { clockDriver } from '../../src/observe/clock-driver.ts'
import { memoryStore } from '../../src/observe/memory-store.ts'
import { record } from '../../src/observe/record.ts'
import { timeMachine, type Ticker } from '../../src/observe/time-machine.ts'
import { must, settle, typingSim } from './typing.ts'

/** A ticker run by hand; the time machine and the driver both wait on it, so every waiting frame runs. */
function fakeTicker() {
  let now = 0
  const waiting = new Set<() => void>()
  const ticker: Ticker = { now: () => now, frame: fn => { waiting.add(fn); return () => { waiting.delete(fn) } } }
  return { ticker, async run(ms: number) { now += ms; const fns = [...waiting]; waiting.clear(); fns.forEach(fn => fn()); await settle(); await settle() } }
}
const registry = () => { const r = Registry.create(); must(r.add(uiProvider)); return r }
const time = async (app: Application) => must(await app.call('main', 'clock').now(null))

async function setup() {
  const app = await typingSim()
  const store = memoryStore(), rec = await record(app, store)
  const t = fakeTicker()
  const tm = await timeMachine({ store, listen: rec.listen }, { ticker: t.ticker })
  const d = clockDriver(app, registry(), tm, { ticker: t.ticker })
  return { app, tm, d, t, done() { d.close(); tm.close(); rec.stop() } }
}

test('drives the sole sim clock at speed × real time', async () => {
  const s = await setup()
  expect(s.d.driving).toBe('clock')
  s.tm.setSpeed(1 / 30)
  for (let i = 0; i < 3; i++) await s.t.run(1000)
  expect(await time(s.app)).toBeCloseTo(100)
  s.done(); await s.app.close()
})

test('pause stops advancing', async () => {
  const s = await setup()
  await s.t.run(100)
  const before = await time(s.app)
  expect(before).toBe(100)
  s.tm.pause()
  await s.t.run(1000)
  expect(await time(s.app)).toBe(before)
  s.done(); await s.app.close()
})

test('ticks are capped at 20 a second', async () => {
  const s = await setup()
  for (let i = 0; i < 4; i++) { await s.t.run(10); expect(await time(s.app)).toBe(0) }   // under 50 ms: no tick yet
  await s.t.run(10)
  expect(await time(s.app)).toBe(50)
  s.done(); await s.app.close()
})

test('two sim clocks: no driving, reason given', async () => {
  const app = await typingSim()
  const d = app.deployment()
  must(await app.apply({ ...d, pods: { ...d.pods, clock2: { ...d.pods['clock']! } }, runtimes: { main: { ...d.runtimes['main']!, pods: [...d.runtimes['main']!.pods, 'clock2'] } } }))
  const store = memoryStore(), rec = await record(app, store), t = fakeTicker()
  const tm = await timeMachine({ store, listen: rec.listen }, { ticker: t.ticker })
  const dr = clockDriver(app, registry(), tm, { ticker: t.ticker })
  expect(dr.driving).toBeNull()
  expect(dr.reason).toContain('2 pods')
  dr.close(); tm.close(); rec.stop(); await app.close()
})
