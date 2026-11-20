// boot-pages.ts: the pages to boot with (Main always there; nothing migrated when the stored document failed to load),
// and the mirror between the Platform and the page store: a store write made by a listener while it reseeds is pushed.
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, type NanoResult } from '@pritzlaff/nano-core'
import { Platform } from '@pritzlaff/nano-platform'
import './host-deploy-setup.ts'

const { bootPages, mirror } = await import('../src/boot-pages.ts')
const { pageStore } = await import('../src/lib/pages.ts')
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const strs = (v: unknown) => JSON.parse(JSON.stringify(v))
const untouched = new Proxy({}, { get() { throw new Error('the host was used') } }) as never

test('stored pages saved without Main still boot with Main', async () => {
  const r = must(await bootPages(untouched, localStorage, null, { pages: { two: { slots: {} } } }))
  expect(strs(r)).toEqual({ pages: { two: { slots: {} }, workspace: { slots: {}, meta: { title: 'Workspace', order: 0 } } } })
})

test('a stored document that failed to load: nothing migrated, nothing placed, Main alone', async () => {
  localStorage.setItem('workspace-starter.saved-workspaces', JSON.stringify([{ path: '/t', title: 'T' }]))
  const doc = { pods: {}, runtimes: {}, layout: { pages: [{ id: 'old', title: 'Old', slots: [] }] } }
  expect(strs(must(await bootPages(untouched, localStorage, doc, null, false)))).toEqual({ pages: { workspace: { slots: {}, meta: { title: 'Workspace', order: 0 } } } })
  localStorage.clear()
})

test('mirror: a write by another store listener during a reseed reaches the Platform', async () => {
  const registry = Registry.create(), app = must(await Application.create(must(AppDeployment.assemble({ pods: {}, runtimes: {} }, registry))))
  const platform = Platform.create(app, registry, { pages: { workspace: { slots: {}, meta: { title: 'Workspace', order: 0 } } } })
  const store = pageStore([], () => true)
  mirror(platform, store, () => app.deployment())
  // a listener (as the nav or a dock) that renames a page it sees arrive
  store.subscribe(() => { const p = store.get('notes'); if (p && p.title === 'Notes') store.set({ ...p, title: 'Renamed' }) })
  platform.apply({ pages: { ...platform.document().doc.pages, notes: { slots: {}, meta: { title: 'Notes', order: 1 } } } })
  expect(store.get('notes')!.title).toBe('Renamed')
  expect((platform.document().doc.pages['notes']!.meta as { title: string }).title).toBe('Renamed')
  await app.close()
})
