import { expect, test } from 'bun:test'
import { pair } from '../../src/recorder/entry.ts'
import { memoryStore } from '../../src/recorder/memory-store.ts'
import { record } from '../../src/recorder/record.ts'
import { sleep, typing as app } from './typing.ts'

const typing = async () => ({ app: await app(), store: memoryStore() })

test('the first entry is the deployment in force', async () => {
  const { app, store } = await typing()
  await record(app, store)
  const [first] = await store.range()
  expect(first!.event.type).toBe('deployment')
})

test('typing h then hi records two root sends with their input, and the flush they caused', async () => {
  const { app, store } = await typing()
  await record(app, store)
  await app.call('main', 'input').change('h')
  await app.call('main', 'input').change('hi')
  await sleep(80)
  const msgs = pair(await store.range())
  const roots = msgs.filter(m => m.sent.from === 'host' && m.sent.to === 'input')
  expect(roots.map(m => m.sent.input)).toEqual(['"h"', '"hi"'])
  // the debounce's flush is a send of its own (no cause); what it triggers is caused by it
  const flush = msgs.find(m => m.sent.kind === 'pipe' && m.sent.from === 'debounce')!
  expect(flush.sent.input).toBe('"hi"')
  expect(msgs.some(m => m.sent.cause === flush.sent.id && m.sent.to === 'log')).toBe(true)
  expect(msgs.every(m => m.outcome?.type === 'delivered')).toBe(true)
})

test('an apply adds a deployment entry after the applied event', async () => {
  const { app, store } = await typing()
  await record(app, store)
  await app.apply(app.deployment())
  const types = (await store.range()).map(e => e.event.type)
  expect(types[0]).toBe('deployment')
  const i = types.indexOf('applied')
  expect(i).toBeGreaterThan(0)
  expect(types[i + 1]).toBe('deployment')
})

test('seq continues after the store, and after stop nothing more is recorded', async () => {
  const { app, store } = await typing()
  const stop = await record(app, store)
  await app.call('main', 'input').change('h')
  const n = await store.size()
  stop()
  await app.call('main', 'input').change('hi')
  await sleep(60)
  expect(await store.size()).toBe(n)
  await record(app, store)
  const seqs = (await store.range()).map(e => e.seq)
  expect(seqs).toEqual(seqs.map((_, i) => i + 1))
})

test('a store that already dropped its oldest continues from the last seq', async () => {
  const { app } = await typing()
  const store = memoryStore({ max: 3 })
  for (let n = 1; n <= 5; n++) store.append({ seq: n, at: n, event: { type: 'warning', reason: 'x' } })
  await record(app, store)
  expect((await store.range()).map(e => e.seq)).toEqual([4, 5, 6])
})

test('a clean start is marked only when asked, and at comes from the injected now', async () => {
  const { app, store } = await typing()
  await record(app, store, { clean: true, now: () => 42 })
  const [first] = await store.range()
  expect(first).toMatchObject({ at: 42, event: { type: 'deployment', clean: true } })
  const plain = memoryStore()
  await record(app, plain)
  expect((await plain.range())[0]!.event).not.toHaveProperty('clean')
})

test('events during record\'s own awaits are kept, after the deployment, in order', async () => {
  const { app } = await typing()
  const inner = memoryStore()
  const slow = { ...inner, flush: () => new Promise<void>(r => setTimeout(r, 5)) }
  const started = record(app, slow)
  const call = app.call('main', 'map').map('a')
  await started
  await call
  const entries = await inner.range()
  expect(entries[0]!.event.type).toBe('deployment')
  expect(pair(entries).map(m => m.sent.input)).toContain('"a"')
  expect(entries.map(e => e.seq)).toEqual(entries.map((_, i) => i + 1))
})
