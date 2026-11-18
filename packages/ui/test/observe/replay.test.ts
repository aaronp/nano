import { expect, test } from 'bun:test'
import { success, type Application } from '@pritzlaff/nano-core'
import { CAP, pair, snap } from '../../src/observe/entry.ts'
import { memoryStore } from '../../src/observe/memory-store.ts'
import { record } from '../../src/observe/record.ts'
import { diverge, replay, roots } from '../../src/observe/replay.ts'
import { log, must, sleep, typing } from './typing.ts'

/** h, hi, pause, hey, pause: the log is HI, HEY. Stopped before the log is read, so the recording holds only typing. */
async function recordTyping(app: Application) {
  const store = memoryStore()
  const { stop } = await record(app, store, { clean: true })
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
  const { stop } = await record(app, second)
  const r = must(await replay(app, first))
  expect(r).toMatchObject({ sent: 3, failed: 0, applied: 0, restarted: 0, from: 1 })
  await sleep(80)
  stop()
  expect(await log(app)).toEqual(success(['HI', 'HEY']))   // restarted, then rebuilt, not doubled
  expect(diverge(pair(await first.range(r.from, r.to)), pair(await second.range()))).toBeNull()
})

test('replay too fast diverges, and diverge says where', async () => {
  const app = await typing()
  const first = await recordTyping(app)
  const second = memoryStore()
  const { stop } = await record(app, second)
  must(await replay(app, first, { sleep: async () => {} }))
  await sleep(80)
  stop()
  const d = diverge(pair(await first.range()), pair(await second.range()))
  expect(d).not.toBeNull()
  expect(d!.recorded?.sent.kind).toBe('pipe')
  expect(d!.recorded?.sent.from).toBe('debounce')
  expect(d!.recorded?.sent.input).toBe('"hi"')   // the HI flush: all at once, the debounce batched it away
})

test('replay refuses when the store dropped the clean start', async () => {
  const app = await typing()
  const store = memoryStore({ max: 3 })
  const { stop } = await record(app, store, { clean: true })
  await app.call('main', 'input').change('h')
  await sleep(60)
  stop()
  const r = await replay(app, store)
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.fail.type).toBe('not-found')
})

test('replay refuses a recording whose oldest entry is not a clean start', async () => {
  const app = await typing()
  const store = memoryStore()
  const { stop } = await record(app, store)
  await app.call('main', 'map').map('a')
  stop()
  const r = await replay(app, store, { sleep: async () => {} })
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.fail.type).toBe('not-found')
})

test('replay to a seq before the clean start is refused', async () => {
  const app = await typing()
  const store = memoryStore()
  store.append({ seq: 5, at: 0, event: { type: 'deployment', deployment: app.deployment(), clean: true } })
  const r = await replay(app, store, { to: 4 })
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.fail.type).toBe('not-found')
})

test('a truncated root input is refused', async () => {
  const app = await typing()
  const store = memoryStore()
  store.append({ seq: 1, at: 0, event: { type: 'deployment', deployment: app.deployment(), clean: true } })
  const input = snap('x'.repeat(CAP + 10))
  store.append({ seq: 2, at: 1, event: { type: 'sent', id: 'm1', runtime: 'main', kind: 'call', from: 'host', to: 'input', port: 'nano.ui.Input/change', correlation: 'm1', input } })
  const r = await replay(app, store)
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.fail.type).toBe('invalid-input')
})
