// The stored document: load and save it, storage that throws, and the one-time migration of the old keys into pages.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import type { AppDeployment } from '@pritzlaff/nano-core'
import { persisted } from '../src/persist.ts'

const memory = () => {
  const m = new Map<string, string>()
  return { m, storage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } } as unknown as Storage }
}
const doc: AppDeployment = { pods: {}, runtimes: { r: { pods: [], subscriptions: [] } }, layout: { pages: [{ id: 'workspace', title: 'Workspace', slots: [] }] } }

test('save then load round-trips the document; nothing stored loads as null', () => {
  const { storage } = memory(), p = persisted(storage, 'k')
  expect(p.load()).toBeNull()
  p.save(doc)
  expect(p.load()).toEqual(doc)
  storage.setItem('k', '{not json')
  expect(p.load()).toBeNull()
})

test('storage that throws: nothing throws, one status message', () => {
  document.body.innerHTML = ''
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('full') }, removeItem() { throw new Error('blocked') } } as unknown as Storage
  const p = persisted(broken, 'k')
  expect(p.load()).toBeNull()
  expect(p.migrate(broken)).toEqual([])
  p.save(doc); p.save(doc)
  expect(document.querySelectorAll('[data-nano-status]').length).toBe(1)
})

test('migrate reads Main, the saved pages, their dock layouts and templates, and leaves those keys', () => {
  const { m, storage } = memory()
  const config = { root: { type: 'row', content: [{ type: 'component', componentState: { widget: 'example.clock/clock', name: 'clock1' } }, { type: 'component', componentState: { widget: 'nano-explorer' } }] } }
  const template = { template: 'two-cols', order: [{ widget: 'notes' }, null], parked: [{ widget: 'example.clock/clock', name: 'clock2' }], dock: null }
  m.set('workspace-starter.saved-workspaces', JSON.stringify([{ path: '/trading', title: 'Trading', icon: 'chart' }, { path: '/a/b', title: 'AB', icon: 'box' }]))
  m.set('workspace-starter.saved-workspaces.main', JSON.stringify({ title: 'Home', icon: 'home' }))
  m.set('workspace-starter.layout', JSON.stringify(config))
  m.set('workspace-starter.layout.saved./trading.template', JSON.stringify(template))
  m.set('workspace-starter.layout.saved./trading.window-style', 'glass')
  m.set('other', 'kept')
  const pages = persisted(storage, 'k').migrate(storage)
  expect(pages).toEqual([
    { id: 'workspace', title: 'Home', icon: 'home', workspace: config, slots: [{ id: 'clock1', runtime: 'main', pod: 'clock1' }, { id: 'nano-explorer', view: 'nano-explorer' }] },
    { id: 'trading', title: 'Trading', icon: 'chart', workspace: { template }, slots: [{ id: 'notes', view: 'notes' }, { id: 'clock2', runtime: 'main', pod: 'clock2' }] },
    { id: 'a-b', title: 'AB', icon: 'box', slots: [] },
  ])
  expect(m.size).toBe(6)   // the nav and docks still read them
  expect(persisted(storage, 'k').migrate(storage)).toEqual(pages)
})

test('migrate with only the main dock layout gives Main; with nothing, no pages', () => {
  const { m, storage } = memory()
  expect(persisted(storage, 'k').migrate(storage)).toEqual([])
  m.set('workspace-starter.layout.template', JSON.stringify({ template: 'one', order: [{ widget: 'notes' }], parked: [], dock: null }))
  expect(persisted(storage, 'k').migrate(storage)).toEqual([
    { id: 'workspace', title: 'Workspace', workspace: { template: { template: 'one', order: [{ widget: 'notes' }], parked: [], dock: null } }, slots: [{ id: 'notes', view: 'notes' }] },
  ])
  expect(m.size).toBe(1)
})
