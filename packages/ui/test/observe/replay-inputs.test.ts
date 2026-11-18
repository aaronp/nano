/** Replay re-sends every host input after the clean start, at its offset from the reset. No real waiting: map is synchronous. */
import { expect, test } from 'bun:test'
import { success, type Application } from '@pritzlaff/nano-core'
import { pair, type Entry, type MessageStore } from '../../src/observe/entry.ts'
import { memoryStore } from '../../src/observe/memory-store.ts'
import { record } from '../../src/observe/record.ts'
import { replay } from '../../src/observe/replay.ts'
import { log, must, settle, typing } from './typing.ts'

const fast = { sleep: async () => {} }
const map = async (app: Application, x: string) => { must(await app.call('main', 'map').map(x)); await settle() }

/** The log as recorded up to `to`: the values piped into it and delivered (no restarts in between). */
const logAt = async (store: MessageStore, to: number) => pair(await store.range(undefined, to))
  .filter(m => m.sent.kind === 'pipe' && m.sent.to === 'log' && m.outcome?.type === 'delivered').map(m => JSON.parse(m.sent.input!))

async function recorded(steps: (app: Application) => Promise<void>) {
  const app = await typing(), store = memoryStore()
  const { stop } = await record(app, store, { clean: true })
  await steps(app)
  stop()
  return { app, store }
}

test('typing a then b, replayed to the end, rebuilds A, B', async () => {
  const { app, store } = await recorded(async app => { await map(app, 'a'); await map(app, 'b') })
  expect(must(await replay(app, store, fast))).toMatchObject({ sent: 2, failed: 0 })
  await settle()
  expect(await log(app)).toEqual(success(['A', 'B']))
})

test('an apply between two roots is reproduced', async () => {
  const { app, store } = await recorded(async app => {
    await map(app, 'x')
    const d = app.deployment()
    must(await app.apply({ ...d, pods: { ...d.pods, map: { ...d.pods['map']!, config: { code: 'return String(x).toUpperCase() + "!"' } } } }))
    await map(app, 'y')
  })
  expect(await log(app)).toEqual(success(['X', 'Y!']))
  expect(must(await replay(app, store, fast))).toMatchObject({ sent: 2, applied: 1 })
  await settle()
  expect(await log(app)).toEqual(success(['X', 'Y!']))
})

test('a host restart is reproduced', async () => {
  const { app, store } = await recorded(async app => { await map(app, 'a'); must(await app.restart('log')); await map(app, 'b') })
  expect(await log(app)).toEqual(success(['B']))
  expect(must(await replay(app, store, fast))).toMatchObject({ sent: 2, restarted: 1 })
  await settle()
  expect(await log(app)).toEqual(success(['B']))
})

test('replay to a seq rebuilds the state as recorded at that seq', async () => {
  const { app, store } = await recorded(async app => { for (const x of ['a', 'b', 'c']) await map(app, x) })
  const c = pair(await store.range()).find(m => m.sent.input === '"c"')!
  const to = c.seq - 1
  expect(must(await replay(app, store, { ...fast, to }))).toMatchObject({ sent: 2, from: 1, to })
  await settle()
  expect(await log(app)).toEqual(success(await logAt(store, to)))
  expect(await log(app)).toEqual(success(['A', 'B']))
})

const clean = (app: Application, at: number): Entry => ({ seq: 1, at, event: { type: 'deployment', deployment: app.deployment(), clean: true } })
const root = (seq: number, at: number, to: string, port: string, input: string): Entry =>
  ({ seq, at, event: { type: 'sent', id: `m${seq}`, runtime: 'main', kind: 'call', from: 'host', to, port, correlation: `m${seq}`, input } })

test('a root recorded 50 ms after the start is due 50 ms after the reset', async () => {
  const app = await typing(), store = memoryStore()
  store.append(clean(app, 1000))
  store.append(root(2, 1050, 'map', 'nano.ui.Map/map', '"a"'))
  store.append(root(3, 1080, 'map', 'nano.ui.Map/map', '"b"'))
  let t = 5000
  const slept: number[] = []
  must(await replay(app, store, { now: () => t, sleep: async ms => { slept.push(ms); t += ms } }))
  expect(slept).toEqual([50, 30])
})

test('a root recorded with input undefined is re-sent as undefined; a failed root is counted', async () => {
  const app = await typing(), store = memoryStore()
  store.append(clean(app, 0))
  store.append(root(2, 0, 'map', 'nano.ui.Map/map', 'undefined'))
  store.append(root(3, 0, 'log', 'nano.ui.Log/entries', 'undefined'))   // entries takes null: refused
  expect(must(await replay(app, store, fast))).toMatchObject({ sent: 2, failed: 1 })
  await settle()
  expect(await log(app)).toEqual(success(['UNDEFINED']))
})

test('roots sent together are re-sent together; one sent after another settled waits for it', async () => {
  const app = await typing(), store = memoryStore()
  store.append(clean(app, 0))
  store.append(root(2, 0, 'map', 'nano.ui.Map/map', '"a"'))
  store.append(root(3, 0, 'map', 'nano.ui.Map/map', '"b"'))   // sent before a settled
  store.append({ seq: 4, at: 0, event: { type: 'delivered', id: 'm2', ok: true, result: '"A"', ms: 0 } })
  store.append({ seq: 5, at: 0, event: { type: 'delivered', id: 'm3', ok: true, result: '"B"', ms: 0 } })
  store.append(root(6, 0, 'map', 'nano.ui.Map/map', '"c"'))   // sent after both settled
  const seen: string[] = []
  const stop = app.listen(e => {
    if (e.type === 'sent' && e.to === 'map') seen.push(`sent ${e.input}`)
    if (e.type === 'delivered' && e.result.ok && typeof e.result.value === 'string') seen.push(`delivered ${e.result.value}`)
  })
  must(await replay(app, store, fast))
  stop()
  expect(seen.indexOf('sent b')).toBeLessThan(seen.indexOf('delivered A'))
  expect(seen.indexOf('sent c')).toBeGreaterThan(Math.max(seen.indexOf('delivered A'), seen.indexOf('delivered B')))
})
