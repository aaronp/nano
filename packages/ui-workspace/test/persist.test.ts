// The stored documents: the app's and its pages, each under its key; storage that throws; the old keys removed once.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import type { AppDeployment } from '@pritzlaff/nano-core'
import type { UIDeployment } from '@pritzlaff/nano-platform'
import { persisted } from '../src/persist.ts'

const memory = () => {
  const m = new Map<string, string>()
  return { m, storage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) },
    get length() { return m.size }, key: (i: number) => [...m.keys()][i] ?? null } as unknown as Storage }
}
const doc: AppDeployment = { pods: {}, runtimes: { r: { pods: [], subscriptions: [] } } }
const pages: UIDeployment = { pages: { workspace: { slots: { x: { kind: 'view', view: 'nano-explorer' } }, meta: { title: 'Main', order: 0 } } } }

test('save then load round-trips the document and its pages, each under its key; nothing stored loads as null', () => {
  const { m, storage } = memory(), p = persisted(storage, 'k', 'p')
  expect(p.load()).toBeNull()
  expect(p.pages()).toBeNull()
  p.save(doc, pages)
  expect(p.load()).toEqual(doc)
  expect(p.pages()).toEqual(pages)
  expect([...m.keys()].sort()).toEqual(['k', 'p'])
  storage.setItem('k', '{not json')
  expect(p.load()).toBeNull()
})

test('storage that throws: nothing throws, one status message', () => {
  document.body.innerHTML = ''
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('full') }, removeItem() { throw new Error('blocked') } } as unknown as Storage
  const p = persisted(broken, 'k', 'p')
  expect(p.load()).toBeNull()
  expect(p.pages()).toBeNull()
  p.save(doc, pages); p.save(doc, pages)
  expect(document.querySelectorAll('[data-nano-status]').length).toBe(1)
})

test('the first save that works removes every old key, once a session; one that fails removes none', () => {
  const { m, storage } = memory(), p = persisted(storage, 'k', 'p')
  m.set('workspace-starter.saved-workspaces', '[]'); m.set('workspace-starter.layout', '{}'); m.set('workspace-starter.layout.saved./gone', '{}'); m.set('other', 'kept')
  persisted({ ...storage, setItem() { throw new Error('full') } } as unknown as Storage, 'k', 'p').save(doc, pages)
  expect(m.has('workspace-starter.layout')).toBe(true)
  p.save(doc, pages)
  expect([...m.keys()].sort()).toEqual(['k', 'other', 'p'])
  m.set('workspace-starter.layout', '{}'); p.save(doc, pages)
  expect(m.has('workspace-starter.layout')).toBe(true)   // once a session
})
