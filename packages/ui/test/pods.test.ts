/**
 * Debounce's batch and max wait; input's change and kind.
 */
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, Pod, port, success, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider, { Debounce, debounce, input, Input, Log, log } from '../src/index.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const open = async (d: AppDeployment) => {
  const r = Registry.create()
  r.add(uiProvider)
  return must(await Application.create(must(AppDeployment.assemble(d, r)), {}))
}
// wait's flushed goes to last, its batch to all
const waits = (config: unknown) => open({
  pods: { wait: Pod.eager(debounce, { config }), last: Pod.lazy(log), all: Pod.lazy(log) },
  runtimes: { main: { pods: ['wait', 'last', 'all'], subscriptions: [
    { kind: 'pipe', from: 'wait', source: port(Debounce, Debounce.ops.flushed), to: 'last', target: port(Log, Log.ops.log) },
    { kind: 'pipe', from: 'wait', source: port(Debounce, Debounce.ops.batch), to: 'all', target: port(Log, Log.ops.log) },
  ] } },
})

test('a flush publishes the newest value as flushed and everything queued, oldest first, as batch', async () => {
  const app = await waits({ quietMs: 10 })
  for (const v of [1, 2, 3]) await app.call('main', 'wait').push(v)
  await sleep(40)
  expect(await app.call('main', 'last').entries(null)).toEqual(success([3]))
  expect(await app.call('main', 'all').entries(null)).toEqual(success([[1, 2, 3]]))
})

test('with maxWaitMs, pushes that never go quiet still flush by the max wait', async () => {
  const app = await waits({ quietMs: 30, maxWaitMs: 50 })
  for (let i = 0; i < 8; i++) { await app.call('main', 'wait').push(i); await sleep(15) }   // never 30ms quiet, over ~120ms
  const r = must(await app.call('main', 'all').entries(null)) as number[][]
  expect(r.length).toBeGreaterThanOrEqual(1)
  expect(r[0]![0]).toBe(0)
})

test('without maxWaitMs, pushes that never go quiet do not flush until they stop', async () => {
  const app = await waits({ quietMs: 30 })
  for (let i = 0; i < 8; i++) { await app.call('main', 'wait').push(i); await sleep(15) }
  expect(await app.call('main', 'all').entries(null)).toEqual(success([]))
  await sleep(60)
  expect(await app.call('main', 'all').entries(null)).toEqual(success([[0, 1, 2, 3, 4, 5, 6, 7]]))
})

test('a closed debounce publishes nothing, even with a batch pending', async () => {
  const app = await waits({ quietMs: 20 })
  await app.call('main', 'wait').push('x')
  let sent = 0
  app.listen(e => { if (e.type === 'sent' && e.from === 'wait') sent++ })
  await app.close()
  await sleep(50)
  expect(sent).toBe(0)
})

test('a config out of range is refused', async () => {
  const r = Registry.create(); r.add(uiProvider)
  expect(AppDeployment.assemble({ pods: { w: Pod.eager(debounce, { config: { quietMs: 10, maxWaitMs: -1 } }) }, runtimes: { main: { pods: ['w'], subscriptions: [] } } }, r).ok).toBe(false)
})

test('input: change returns its input, so each edit can be piped, and kind is a config', async () => {
  const app = await open({
    pods: { in: Pod.eager(input, { config: { kind: 'number' } }), out: Pod.lazy(log) },
    runtimes: { main: { pods: ['in', 'out'], subscriptions: [
      { kind: 'pipe', from: 'in', source: port(Input, Input.ops.change), to: 'out', target: port(Log, Log.ops.log) },
    ] } },
  })
  expect(await app.call('main', 'in').change(4)).toEqual(success(4))
  await app.call('main', 'in').change(42)
  await sleep(10)
  expect(await app.call('main', 'out').entries(null)).toEqual(success([4, 42]))
})

test('input: an unknown kind is refused', async () => {
  const r = Registry.create(); r.add(uiProvider)
  expect(AppDeployment.assemble({ pods: { i: Pod.eager(input, { config: { kind: 'date' } }) }, runtimes: { main: { pods: ['i'], subscriptions: [] } } }, r).ok).toBe(false)
})
