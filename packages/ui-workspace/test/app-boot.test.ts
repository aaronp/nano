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
  const auto = autosave({ host: h.host, stores, app, doc: document })
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

test('start-up imports what the working copy lists (it is the source of truth), and keeps one that fails', async () => {
  const storage = memory()
  const app = appStore(storage)
  app.setWorking({ nano: 1, title: 'T', imports: [{ url: 'https://ok/m.json', trust: 'sandboxed' }, { url: 'https://dead/m.json', trust: 'sandboxed' }], systems: [], workspaces: [] })
  storage.m.set('workspace-starter.imports', JSON.stringify([{ url: 'https://old/m.json', name: 'old', version: '1' }]))   // stale: not in the copy
  document.body.innerHTML = ''
  const h = appHost(), title = titleStore(storage, document), stores = realStores(document, storage as never, title)
  const seen: string[] = []
  const r = await restoreApp({ host: h.host, stores, app, catalog: h.catalog, importPackage: async url => { seen.push(url); return url.includes('dead') ? { error: 'down' } : { name: 'ok', version: '1' } } })
  expect(seen).toEqual(['https://ok/m.json', 'https://dead/m.json'])   // once each; the stale one is not loaded
  expect(r.failed).toEqual([{ url: 'https://dead/m.json', error: 'down' }])
  expect(stores.imports.list().map(i => i.url)).toEqual(['https://ok/m.json'])   // the failed one had no record to keep
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
