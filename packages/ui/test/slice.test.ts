/**
 * The nano.ui slice, headless: input → debounce → map → log, through assemble and Application.create.
 */
import { describe, expect, test } from 'bun:test'
import { Application, assemble, createRegistry, Pod, port, success, type AppDeployment, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider, { Debounce, debounce, input, Input, Log, log, map, MapIface } from '../src/index.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const open = async (d: AppDeployment) => {
  const r = createRegistry()
  r.add(uiProvider)
  return must(await Application.create(must(assemble(d, r)), {}))
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const slice = (code = 'return String(x).toUpperCase()'): AppDeployment => ({
  pods: {
    in: Pod.eager(input), wait: Pod.eager(debounce, { config: { quietMs: 10 } }),
    up: Pod.lazy(map, { config: { code } }), out: Pod.lazy(log),
  },
  runtimes: { main: { pods: ['in', 'wait', 'up', 'out'], subscriptions: [
    { kind: 'pipe', from: 'in', source: port(Input, Input.ops.submit), to: 'wait', target: port(Debounce, Debounce.ops.push) },
    { kind: 'pipe', from: 'wait', source: port(Debounce, Debounce.ops.flushed), to: 'up', target: port(MapIface, MapIface.ops.map) },
    { kind: 'pipe', from: 'up', source: port(MapIface, MapIface.ops.map), to: 'out', target: port(Log, Log.ops.log) },
  ] } },
})

describe('the nano.ui slice', () => {
  test('given the slice, when "h", "hi" are submitted within the quiet time, then the log holds only "HI"', async () => {
    const app = await open(slice())
    await app.call('main', 'in').submit('h')
    await app.call('main', 'in').submit('hi')
    await sleep(40)
    expect(await app.call('main', 'out').entries(null)).toEqual(success(['HI']))
  })

  test('given a map whose code does not parse, when it is called, then it fails with threw and the app keeps running', async () => {
    const app = await open(slice('return ('))
    expect(await app.call('main', 'up').map(1)).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(await app.call('main', 'in').submit('x')).toEqual(success('x'))
  })

  test('given a map whose code throws, when it is called, then that call fails and the next succeeds', async () => {
    const app = await open(slice('if (x === 1) throw new Error("no"); return x'))
    expect(await app.call('main', 'up').map(1)).toMatchObject({ ok: false })
    expect(await app.call('main', 'up').map(2)).toEqual(success(2))
  })

  test('given a log with max 2, when three entries are logged, then it keeps the newest two', async () => {
    const app = await open({ pods: { out: Pod.lazy(log, { config: { max: 2 } }) }, runtimes: { main: { pods: ['out'], subscriptions: [] } } })
    for (const v of [1, 2, 3]) await app.call('main', 'out').log(v)
    expect(await app.call('main', 'out').entries(null)).toEqual(success([2, 3]))
  })

  test('given a debounce, when it is closed before it flushes, then nothing is published, even by a later push', async () => {
    const published: unknown[] = []
    const closers: (() => void)[] = []
    const ctx = { publish: async (_op: unknown, v: unknown) => { published.push(v); return success(null) }, addOnCloseListener: (f: () => void) => { closers.push(f) } }
    const handlers = await debounce.make(ctx as never, { quietMs: 10 })
    const push = handlers.get(port(Debounce, Debounce.ops.push))!
    await push('late')
    closers.forEach(f => f())
    await push('later')
    await sleep(40)
    expect(published).toEqual([])
  })
})
