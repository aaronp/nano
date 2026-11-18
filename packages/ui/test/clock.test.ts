/**
 * The real clock fires after real time; the simulated one moves only by advance and set, firing in due order.
 */
import { expect, test } from 'bun:test'
import { Coord, Implementation, provide, Application, AppDeployment, Registry, Pod, port, success, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider, { Clock, clock, simClock, Log, log } from '../src/index.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const slow = Implementation.define(Coord.namespace('test').implementationId('slow-log'), {
  provides: [Log],
  make: () => { const seen: unknown[] = []; return [provide(Log, {
    log: async v => { await sleep(20); seen.push(v); return success(null) },
    entries: async () => success(seen),
    clear: async () => success(null),
  })] },
})
const open = async (impl: typeof clock | typeof simClock, config?: unknown, sink: typeof log = log) => {
  const r = Registry.create(); r.add(uiProvider); r.add(Coord.namespace('test').provider([slow]))
  const d: AppDeployment = {
    pods: { sim: Pod.eager(impl, { config }), log: Pod.lazy(sink) },
    runtimes: { main: { pods: ['sim', 'log'], subscriptions: [
      { kind: 'pipe', from: 'sim', source: port(Clock, Clock.ops.fired), to: 'log', target: port(Log, Log.ops.log) },
    ] } },
  }
  const app = must(await Application.create(must(AppDeployment.assemble(d, r)), {}))
  const sim = app.call('main', 'sim') as any
  const fired = async () => must(await app.call('main', 'log').entries(null)) as { id: number; tag?: string; at: number }[]
  return { app, sim, fired }
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

test('a forward set fires what falls due', async () => {
  const { sim, fired } = await open(simClock)
  await sim.after({ ms: 10, tag: 'a' })
  await sim.set(20)
  expect((await fired()).map(x => x.tag)).toEqual(['a'])
})

test('a restart resets to config start', async () => {
  const { app, sim } = await open(simClock, { start: 7 })
  await sim.advance(5)
  must(await app.restart('sim'))
  expect(await (app.call('main', 'sim') as any).now(null)).toEqual(success(7))
})

test('cancel on the real clock means it never fires', async () => {
  const { sim, fired } = await open(clock)
  const id = must(await sim.after({ ms: 10 }))
  await sim.cancel(id)
  await sleep(40)
  expect(await fired()).toEqual([])
})

test('overlapping advances are serialized: time never moves back and both count', async () => {
  const { sim, fired } = await open(simClock, undefined, slow as unknown as typeof log)
  await sim.after({ ms: 5, tag: 'a' }); await sim.after({ ms: 15, tag: 'b' })
  const first = sim.advance(10), second = sim.advance(10)
  await Promise.all([first, second])
  expect(await sim.now(null)).toEqual(success(20))
  expect((await fired()).map(x => x.tag)).toEqual(['a', 'b'])
})
