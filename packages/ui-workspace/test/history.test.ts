// The host records its app from creation (host.history), and Reset restarts every pod and starts a fresh clean recording.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
const page = new URL('../../../', import.meta.url).href
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: page })
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { plugin } from 'bun'
import type { AppEvent } from '@pritzlaff/nano-core'

await import('../src/boot-theme.ts')
const { diverge, memoryStore, pair, record, replay } = await import('@pritzlaff/nano-ui')
const { start } = await import('../src/host.ts')

// /bundle/nano-ui.js is packages/ui, as the site serves it.
const nanoUi = new URL('../../ui/src/index.ts', import.meta.url).pathname
plugin({ name: 'served', setup(b) {
  b.onResolve({ filter: /bundle\/nano-ui\.js$/ }, () => ({ path: 'nano-ui', namespace: 'served' }))
  b.onLoad({ filter: /.*/, namespace: 'served' }, () => ({ contents: `export * from '${nanoUi}'; export { default } from '${nanoUi}'`, loader: 'ts' }))
} })
// happy-dom's fetch refuses file: URLs: read them with Bun.file.
const domFetch = globalThis.fetch
beforeAll(() => { globalThis.fetch = (async (u: string) => { const f = Bun.file(new URL(u)), ok = await f.exists(); return { ok, status: ok ? 200 : 404, json: () => f.json() } }) as never })
afterAll(() => { globalThis.fetch = domFetch })

const typing = new URL('../../../examples/typing/nano.json', import.meta.url).href
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
async function host() {
  const r = await start()
  if (!r.ok) throw new Error(r.fail.reason)
  return r.value
}

test('given a fresh host, then its history begins with a clean deployment and importing Typing records its apply', async () => {
  const h = await host()
  const [first, ...rest] = await h.history.store.range()
  expect(first!.event).toMatchObject({ type: 'deployment', clean: true })
  expect(rest).toEqual([])
  expect(await h.importUrl(typing)).toMatchObject({ ok: true })
  const after = (await h.history.store.range()).map(e => e.event)
  expect(after.some(e => e.type === 'applied')).toBe(true)
  expect(after.at(-1)).toMatchObject({ type: 'deployment', deployment: { pods: { input: {}, log: {} } } })
})

test('given Typing typed into, when Reset, then every pod restarts, the log is empty and the history is one clean deployment', async () => {
  const h = await host()
  expect(await h.importUrl(typing)).toMatchObject({ ok: true })
  await h.app.call('main', 'input').change('hi')
  await h.app.call('main', 'log').log('HI')
  expect(await h.app.call('main', 'log').entries(null)).toMatchObject({ ok: true, value: ['HI'] })
  const restarted: string[] = []
  h.app.listen((e: AppEvent) => { if (e.type === 'restarted') restarted.push(e.pod) })

  expect(await h.history.reset()).toMatchObject({ ok: true })
  expect(restarted.sort()).toEqual(Object.keys(h.app.deployment().pods).sort())
  const entries = await h.history.store.range()   // read before the log is, which is a message too
  expect(entries.map(e => e.event)).toEqual([{ type: 'deployment', deployment: h.app.deployment(), clean: true }])
  expect(await h.app.call('main', 'log').entries(null)).toMatchObject({ ok: true, value: [] })
})

test('given a Reset mid-session, then replaying the history gives the same messages at fast and original pace', async () => {
  const h = await host()
  expect(await h.importUrl(typing)).toMatchObject({ ok: true })
  await h.app.call('main', 'map').map('before')
  expect(await h.history.reset()).toMatchObject({ ok: true })
  await h.app.call('main', 'map').map('a')
  await h.app.call('main', 'map').map('b')
  await tick()
  const to = (await h.history.store.range()).at(-1)!.seq
  for (const pace of ['fast', 'original'] as const) {
    const second = memoryStore(), { stop } = await record(h.app, second)
    const r = await replay(h.app, h.history.store, { to, pace })
    await tick()
    stop()
    if (!r.ok) throw new Error(r.fail.reason)
    expect(r.value).toMatchObject({ sent: 2, failed: 0 })
    expect(diverge(pair(await h.history.store.range(r.value.from, r.value.to)), pair(await second.range()))).toBeNull()
  }
  expect(await h.app.call('main', 'log').entries(null)).toMatchObject({ ok: true, value: ['A', 'B'] })
})

test('given two Resets at once, then they are one: the history is one clean deployment, recorded once from then on', async () => {
  const h = await host()
  expect(await h.importUrl(typing)).toMatchObject({ ok: true })
  await h.app.call('main', 'map').map('x')
  const [a, b] = await Promise.all([h.history.reset(), h.history.reset()])
  expect([a.ok, b.ok]).toEqual([true, true])
  expect((await h.history.store.range()).map(e => e.event)).toEqual([{ type: 'deployment', deployment: h.app.deployment(), clean: true }])
  await h.app.call('main', 'map').map('y')
  const seqs = (await h.history.store.range()).map(e => e.seq)
  expect(seqs).toEqual([...new Set(seqs)])   // one recorder: no entry twice
  expect(seqs.length).toBe(new Set((await h.history.store.range()).map(e => JSON.stringify(e.event))).size)
})
