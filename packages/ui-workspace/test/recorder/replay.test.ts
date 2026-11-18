import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, success, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider from '@pritzlaff/nano-ui'
import { CAP, pair, snap } from '../../src/recorder/entry.ts'
import { memoryStore } from '../../src/recorder/memory-store.ts'
import { record } from '../../src/recorder/record.ts'
import { diverge, replay, roots } from '../../src/recorder/replay.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function typing() {
  const file: AppDeployment = await Bun.file(new URL('../../../../examples/typing/nano.json', import.meta.url)).json()
  const registry = Registry.create()
  must(registry.add(uiProvider))
  const quick = { ...file, pods: { ...file.pods, debounce: { ...file.pods['debounce']!, config: { quietMs: 20, maxWaitMs: 200 } } } }
  return must(await Application.create(must(AppDeployment.assemble(quick, registry)), {}))
}
const log = (app: Application) => app.call('main', 'log').entries(null)

/** h, hi, pause, hey, pause: the log is HI, HEY. Stopped before the log is read, so the recording holds only typing. */
async function recordTyping(app: Application) {
  const store = memoryStore()
  const stop = await record(app, store)
  await app.call('main', 'input').change('h')
  await app.call('main', 'input').change('hi')
  await sleep(60)
  await app.call('main', 'input').change('hey')
  await sleep(60)
  stop()
  return store
}

test('roots are the host calls nothing caused', async () => {
  const app = await typing()
  const msgs = pair(await (await recordTyping(app)).range())
  expect(roots(msgs).map(m => m.sent.input)).toEqual(['"h"', '"hi"', '"hey"'])
})

test('replaying a recording rebuilds the log and the same messages come out', async () => {
  const app = await typing()
  const first = await recordTyping(app)
  expect(await log(app)).toEqual(success(['HI', 'HEY']))
  const second = memoryStore()
  const stop = await record(app, second)
  expect(await replay(app, first)).toEqual(success({ sent: 3 }))
  await sleep(80)
  stop()
  expect(await log(app)).toEqual(success(['HI', 'HEY']))   // restarted, then rebuilt, not doubled
  expect(diverge(pair(await first.range()), pair(await second.range()))).toBeNull()
})

test('replay too fast diverges, and diverge says where', async () => {
  const app = await typing()
  const first = await recordTyping(app)
  const second = memoryStore()
  const stop = await record(app, second)
  must(await replay(app, first, { sleep: async () => {} }))
  await sleep(80)
  stop()
  const d = diverge(pair(await first.range()), pair(await second.range()))
  expect(d).not.toBeNull()
  expect(d!.recorded?.sent.kind).toBe('pipe')
  expect(d!.recorded?.sent.from).toBe('debounce')
  expect(d!.recorded?.sent.input).toBe('"hi"')   // the HI flush: all at once, the debounce batched it away
})

test('replay refuses when the store dropped the start', async () => {
  const app = await typing()
  const store = memoryStore({ max: 3 })
  const stop = await record(app, store)
  await app.call('main', 'input').change('h')
  await sleep(60)
  stop()
  const r = await replay(app, store)
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.fail.type).toBe('not-found')
})

test('replay from after an apply uses the later deployment', async () => {
  const app = await typing()
  const store = memoryStore()
  const stop = await record(app, store)
  const d = app.deployment()
  must(await app.apply({ ...d, pods: { ...d.pods, map: { ...d.pods['map']!, config: { code: 'return x + "!"' } } } }))
  await app.call('main', 'input').change('a')
  await sleep(60)
  stop()
  const second = (await store.range()).filter(e => e.event.type === 'deployment')[1]!
  must(await replay(app, store, { from: second.seq }))
  await sleep(60)
  expect(await log(app)).toEqual(success(['a!']))
})

test('a truncated root input is refused', async () => {
  const app = await typing()
  const store = memoryStore()
  store.append({ seq: 1, at: 0, event: { type: 'deployment', deployment: app.deployment() } })
  const input = snap('x'.repeat(CAP + 10))
  store.append({ seq: 2, at: 1, event: { type: 'sent', id: 'm1', runtime: 'main', kind: 'call', from: 'host', to: 'input', port: 'nano.ui.Input/change', correlation: 'm1', input } })
  const r = await replay(app, store)
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.fail.type).toBe('invalid-input')
})
