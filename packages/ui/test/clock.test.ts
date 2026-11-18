/**
 * The real clock fires after real time; the simulated one moves only by advance and set, firing in due order.
 */
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, Pod, port, success, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider, { Clock, clock, simClock, Log, log } from '../src/index.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const open = async (impl: typeof clock | typeof simClock, config?: unknown) => {
  const r = Registry.create(); r.add(uiProvider)
  const d: AppDeployment = {
    pods: { sim: Pod.eager(impl, { config }), log: Pod.lazy(log) },
    runtimes: { main: { pods: ['sim', 'log'], subscriptions: [
      { kind: 'pipe', from: 'sim', source: port(Clock, Clock.ops.fired), to: 'log', target: port(Log, Log.ops.log) },
    ] } },
  }
  const app = must(await Application.create(must(AppDeployment.assemble(d, r)), {}))
  const sim = app.call('main', 'sim') as any
  const fired = async () => must(await app.call('main', 'log').entries(null)) as { id: number; tag?: string; at: number }[]
  return { sim, fired }
}

test('advance fires due timers in due order, ties by start order', async () => {
  const { sim, fired } = await open(simClock)
  await sim.after({ ms: 30, tag: 'c' }); await sim.after({ ms: 10, tag: 'a' }); await sim.after({ ms: 10, tag: 'b' })
  await sim.advance(30)
  const f = await fired()
  expect(f.map(x => x.tag)).toEqual(['a', 'b', 'c'])
  expect(f.map(x => x.at)).toEqual([10, 10, 30])
})

test('nothing fires before its time', async () => {
  const { sim, fired } = await open(simClock)
  await sim.after({ ms: 10 })
  await sim.advance(9)
  expect(await fired()).toEqual([])
  await sim.advance(1)
  expect((await fired()).length).toBe(1)
})

test('cancel before the advance means it never fires', async () => {
  const { sim, fired } = await open(simClock)
  const id = must(await sim.after({ ms: 5 }))
  expect(await sim.cancel(id)).toEqual(success(null))
  expect(await sim.cancel(999)).toEqual(success(null))
  await sim.advance(10)
  expect(await fired()).toEqual([])
})

test('after(0) fires on advance(0)', async () => {
  const { sim, fired } = await open(simClock)
  await sim.after({ ms: 0 })
  await sim.advance(0)
  expect((await fired()).length).toBe(1)
})

test('now follows advance and set', async () => {
  const { sim } = await open(simClock)
  expect(await sim.now(null)).toEqual(success(0))
  await sim.advance(25)
  expect(await sim.now(null)).toEqual(success(25))
  await sim.set(100)
  expect(await sim.now(null)).toEqual(success(100))
  const r = await sim.set(50)
  expect(r.ok).toBe(false)
  expect(r.fail.type).toBe('invalid-input')
})

test('config start sets the initial time', async () => {
  const { sim } = await open(simClock, { start: 1000 })
  expect(await sim.now(null)).toEqual(success(1000))
})

test('the real clock fires after real time', async () => {
  const { sim, fired } = await open(clock)
  await sim.after({ ms: 5 })
  await sleep(50)
  expect((await fired()).length).toBe(1)
})
