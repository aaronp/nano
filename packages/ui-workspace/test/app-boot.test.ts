// Start-up and autosave of the working copy over the real stores and one storage: boot, change, "reload", boot again.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import { PlatformOps as P } from '@composable/platform'
import { snapshotApp } from '../src/app/snapshot'
import { realStores } from '../src/app/stores'
import { appStore, titleStore } from '../src/app/store'
import { autosave, restoreApp } from '../src/app/boot'
import { appHost, Profile, tick } from './fixtures/app-host'

const memory = () => {
  const m = new Map<string, string>(); let writes = 0
  return { m, get writes() { return writes }, getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { if (k === 'nano.working') writes++; m.set(k, v) } }
}
/** One page load over `storage`: a fresh host with its built-in profile, the real stores, restore, then autosave. */
async function boot(storage: ReturnType<typeof memory>) {
  document.body.innerHTML = '<span slot="title">Nano</span>'
  const h = appHost()
  await h.call('platform', P.createComponent, { kind: 'profile', name: 'profile', system: 'host' })
  const title = titleStore(storage, document), app = appStore(storage)
  const stores = realStores(document, storage as never, title)
  title.show()
  const imported: string[] = []
  const r = await restoreApp({ host: h.host, stores, app, catalog: h.catalog, importPackage: async url => { imported.push(url); return {} } })
  const auto = autosave({ host: h.host, stores, app, doc: document, initial: !r.protect })
  return { ...h, app, stores, title, imported, r, auto }
}

test('with a working copy holding a user instance, start-up recreates it (a reload keeps what was added in Systems)', async () => {
  const storage = memory()
  const one = await boot(storage)
  expect(one.r.restored).toBe(false)
  await one.call('platform', P.createSystem, 'lab')
  await one.call('platform', P.createComponent, { kind: 'range', name: 'r1', system: 'lab' })
  await one.call('platform', P.createComponent, { kind: 'log', name: 'l1', system: 'lab' })
  await tick(700)   // the debounce
  one.auto.stop()
  expect(one.app.working()!.systems.find(s => s.id === 'lab')!.instances.map(i => i.id).sort()).toEqual(['l1', 'r1'])

  const two = await boot(storage)   // the reload
  expect(two.r).toMatchObject({ restored: true, notes: [] })
  const app = await snapshotApp({ host: two.host, stores: two.stores })
  expect(app.systems.find(s => s.id === 'lab')!.instances.map(i => i.id).sort()).toEqual(['l1', 'r1'])
  two.auto.stop()
}, 10_000)

test('start-up imports what the working copy lists (it is the source of truth) in parallel, and a failed one keeps its record', async () => {
  const storage = memory()
  const app = appStore(storage)
  app.setWorking({ nano: 1, title: 'T', imports: [{ url: 'https://ok/m.json', trust: 'sandboxed' }, { url: 'https://dead/m.json', trust: 'sandboxed' }, { url: 'https://ok2/m.json', trust: 'trusted' }], systems: [], workspaces: [] })
  storage.m.set('workspace-starter.imports', JSON.stringify([{ url: 'https://old/m.json', name: 'old', version: '1' }]))   // stale: not in the copy; the dead one has no record
  document.body.innerHTML = ''
  const h = appHost(), title = titleStore(storage, document), stores = realStores(document, storage as never, title)
  const seen: string[] = []; const t0 = Date.now()
  const r = await restoreApp({ host: h.host, stores, app, catalog: h.catalog, importPackage: async url => { seen.push(url); await tick(150); return url.includes('dead') ? { error: 'down' } : { name: 'ok', version: '1' } } })
  expect(seen).toEqual(['https://ok/m.json', 'https://dead/m.json', 'https://ok2/m.json'])   // once each; the stale one is not loaded
  expect(Date.now() - t0).toBeLessThan(400)   // not 3 x 150
  expect(r.failed).toEqual([{ url: 'https://dead/m.json', error: 'down' }])
  expect(stores.imports.list().map(i => i.url)).toEqual(['https://ok/m.json', 'https://dead/m.json', 'https://ok2/m.json'])   // the copy's order; the failed one is kept
})

test('a partial restore is not written back: the copy is kept as unrestored, nothing is snapshotted at start, the next real change saves', async () => {
  const storage = memory(), app = appStore(storage)
  const copy = { nano: 1 as const, title: 'T', imports: [{ url: 'https://dead/m.json', trust: 'sandboxed' as const }], systems: [{ id: 'host', instances: [{ id: 'g1', kind: 'gone' }], subscriptions: [] }], workspaces: [] }
  app.setWorking(copy)
  const raw = storage.getItem('nano.working')
  document.body.innerHTML = ''
  const h = appHost(), title = titleStore(storage, document), stores = realStores(document, storage as never, title)
  await h.call('platform', P.createComponent, { kind: 'profile', name: 'profile', system: 'host' })
  const r = await restoreApp({ host: h.host, stores, app, catalog: h.catalog, importPackage: async () => ({ error: 'down' }) })
  expect(r.say).toContain('nano.working.unrestored'); expect(storage.getItem('nano.working.unrestored')).toBe(raw)
  const w0 = storage.writes
  const auto = autosave({ host: h.host, stores, app, doc: document, initial: !r.protect })
  await tick(700)
  expect(storage.writes).toBe(w0); expect(storage.getItem('nano.working')).toBe(raw)
  await h.call('platform', P.createComponent, { kind: 'range', name: 'n1', system: 'host' })
  await tick(700)
  expect(storage.writes).toBe(w0 + 1)
  auto.stop()
}, 10_000)

test('an unreadable working copy is kept as nano.working.bad, the person is told, and it is not overwritten at start', async () => {
  const storage = memory()
  storage.m.set('nano.working', '{"nano":2,"whatever":true}')
  const b = await boot(storage)
  expect(b.r.say).toContain('nano.working.bad'); expect(storage.getItem('nano.working.bad')).toBe('{"nano":2,"whatever":true}')
  expect(b.r.protect).toBe(true)
  b.auto.stop()
})

test('restoreApp never throws: a failing store falls back to a normal start, protected and kept', async () => {
  const storage = memory(), app = appStore(storage)
  app.setWorking({ nano: 1, title: 'T', imports: [], systems: [], workspaces: [] })
  const h = appHost(), stores = realStores(document, storage as never, titleStore(storage, document))
  stores.imports.set = () => { throw new Error('quota') }
  const r = await restoreApp({ host: h.host, stores, app, catalog: h.catalog, importPackage: async () => ({}) })
  expect(r).toMatchObject({ restored: false, protect: true }); expect(r.say).toContain('quota')
  expect(storage.getItem('nano.working.unrestored')).toBe(storage.getItem('nano.working'))
})

test('a busy burst does not starve autosave: it writes within the max wait', async () => {
  const storage = memory(), b = await boot(storage); b.auto.stop()
  const auto = autosave({ host: b.host, stores: b.stores, app: b.app, doc: document, delay: 100, maxWait: 300, initial: false })
  const w0 = storage.writes
  for (let i = 0; i < 14; i++) { document.dispatchEvent(new CustomEvent('nano:changed')); await tick(50) }   // 700 ms of changes, never quiet for 100 ms
  expect(storage.writes).toBeGreaterThan(w0)
  auto.stop()
}, 10_000)

test('a failed write (quota) is reported', async () => {
  const storage = memory(); const set = storage.setItem
  const b = await boot(storage); b.auto.stop()
  storage.setItem = (k: string, v: string) => { if (k === 'nano.working') throw new Error('quota exceeded'); set(k, v) }
  const errors: string[] = []
  const auto = autosave({ host: b.host, stores: b.stores, app: b.app, doc: document, delay: 20, onError: e => errors.push(e) })
  await tick(200)
  expect(errors[0]).toContain('quota'); auto.stop()
})

test('on pagehide a pending change is written at once, not after the delay', async () => {
  const storage = memory(), b = await boot(storage)
  await tick(700)
  await b.call('platform', P.createComponent, { kind: 'range', name: 'p1', system: 'host' })
  const w0 = storage.writes
  window.dispatchEvent(new Event('pagehide'))
  await tick(100)   // far under 500 ms
  expect(storage.writes).toBeGreaterThan(w0)
  expect(b.app.working()!.systems[0]!.instances.map(i => i.id)).toContain('p1')
  b.auto.stop()
}, 10_000)

test('showStatus makes one dismissible role=status message', async () => {
  const { showStatus } = await import('../src/lib/status')
  document.body.innerHTML = ''
  showStatus(document, 'one'); showStatus(document, 'two')
  const els = document.querySelectorAll('[role="status"]'); expect(els).toHaveLength(1); expect(els[0]!.textContent).toContain('two')
  els[0]!.querySelector('button')!.click(); expect(document.querySelector('[role="status"]')).toBeNull()
})

test('changes autosave after 500 ms, coalesced', async () => {
  const storage = memory()
  const b = await boot(storage)
  await tick(700); const base = storage.writes   // the first snapshot becomes the working copy
  expect(base).toBe(1)
  await b.call('platform', P.createComponent, { kind: 'range', name: 'a1', system: 'host' })
  await tick(200)
  await b.call('platform', P.createComponent, { kind: 'range', name: 'a2', system: 'host' })
  await tick(300)
  expect(storage.writes).toBe(base)   // 500 ms after the last change has not come
  await tick(400)
  expect(storage.writes).toBe(base + 1)
  expect(b.app.working()!.systems[0]!.instances.map(i => i.id)).toEqual(['a1', 'a2'])
  await b.call('a1', (await import('@composable/bundle')).Range.ops.setBounds, { min: 0, max: 20, step: 1, value: 5 })   // a config change, no structural one
  await tick(700)
  expect(b.app.working()!.systems[0]!.instances.find(i => i.id === 'a1')!.config).toMatchObject({ max: 20 })
  b.auto.stop()
}, 10_000)

test('the title applies to the app bar and document.title, on start-up and on change; the default is Nano', async () => {
  const storage = memory()
  const b = await boot(storage)
  expect(document.title).toBe('Nano'); expect(document.querySelector('[slot="title"]')!.textContent).toBe('Nano')
  b.title.set('Mine')
  expect(document.title).toBe('Mine'); expect(document.querySelector('[slot="title"]')!.textContent).toBe('Mine')
  await tick(700); expect(b.app.working()!.title).toBe('Mine')   // autosaved
  b.auto.stop()
  const c = await boot(storage)
  expect(document.title).toBe('Mine'); expect(document.querySelector('[slot="title"]')!.textContent).toBe('Mine')
  c.auto.stop()
}, 10_000)
