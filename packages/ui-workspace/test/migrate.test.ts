// Migration into the UIDeployment: the old keys, a document's `layout.pages`, the legacy Main layout, and a file as opened.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import { Coord, type AppDeployment } from '@pritzlaff/nano-core'
import { legacyPages, oldPages, opened, toPlatform, withOldDocks } from '../src/migrate.ts'

const memory = () => {
  const m = new Map<string, string>()
  return { m, storage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) },
    get length() { return m.size }, key: (i: number) => [...m.keys()][i] ?? null } as unknown as Storage }
}
const strs = (v: unknown) => JSON.parse(JSON.stringify(v))
const clock = 'example.clock/clock', d: AppDeployment = { pods: { clock1: { implementation: clock, eager: false }, a: { implementation: 'nano.ui/log', eager: false } }, runtimes: { main: { pods: ['clock1'], subscriptions: [] }, side: { pods: ['a'], subscriptions: [] } } }

test('oldPages reads Main, the saved pages, their dock layouts, templates and window styles, and leaves those keys', () => {
  const { m, storage } = memory()
  const config = { root: { type: 'row', content: [{ type: 'component', componentState: { widget: clock, name: 'clock1' } }, { type: 'component', componentState: { widget: 'nano-explorer' } }] } }
  const template = { template: 'two-cols', order: [{ widget: 'notes' }, null], parked: [{ widget: clock, name: 'clock2' }], dock: null }
  m.set('workspace-starter.saved-workspaces', JSON.stringify([{ path: '/trading', title: 'Trading', icon: 'chart' }, { path: '/a/b', title: 'AB', icon: 'box' }]))
  m.set('workspace-starter.saved-workspaces.main', JSON.stringify({ title: 'Home', icon: 'home' }))
  m.set('workspace-starter.layout', JSON.stringify(config))
  m.set('workspace-starter.layout.saved./trading.template', JSON.stringify(template))
  m.set('workspace-starter.layout.saved./trading.window-style', 'glass')
  const pages = oldPages(storage)
  expect(pages).toEqual([
    { id: 'workspace', title: 'Home', icon: 'home', workspace: config, slots: [{ id: 'clock1', runtime: 'main', pod: 'clock1' }, { id: 'nano-explorer', view: 'nano-explorer' }] },
    { id: 'trading', title: 'Trading', icon: 'chart', workspace: { template, 'window-style': 'glass' }, slots: [{ id: 'notes', view: 'notes' }, { id: 'clock2', runtime: 'main', pod: 'clock2' }] },
    { id: 'a-b', title: 'AB', icon: 'box', slots: [] },
  ])
  expect(m.size).toBe(5)
  expect(oldPages(memory().storage)).toEqual([])
})

test('withOldDocks gives each page its old dock\'s state (layout, template, window style) as its `workspace`', () => {
  const { m, storage } = memory(), config = { root: { type: 'row', content: [] } }, template = { template: 'one', order: [null], parked: [], dock: null }
  m.set('workspace-starter.layout', JSON.stringify(config)); m.set('workspace-starter.layout.window-style', 'focus')
  m.set('workspace-starter.layout.saved./lab.template', JSON.stringify(template))
  expect(withOldDocks(storage, [{ id: 'workspace', title: 'W', slots: [] }, { id: 'lab', title: 'Lab', slots: [], workspace: { root: null } }, { id: 'none', title: 'None', slots: [] }])).toEqual([
    { id: 'workspace', title: 'W', slots: [], workspace: { ...config, 'window-style': 'focus' } },
    { id: 'lab', title: 'Lab', slots: [], workspace: { template } },
    { id: 'none', title: 'None', slots: [] },
  ])
})

test('toPlatform: pod slots by coordinate (the deployment\'s implementation), view slots, title, icon, order and restore point in meta, the dock state its layout', () => {
  const saved = { root: { type: 'column' } }, engine = { root: { type: 'row' }, 'window-style': 'clear', saved, 'saved.template': null }
  const out = toPlatform([
    { id: 'workspace', title: 'Main', icon: 'home', slots: [{ id: 'clock1', runtime: 'main', pod: 'clock1' }, { id: 'x', view: 'nano-explorer' }, { id: 'gone', runtime: 'main', pod: 'gone' }], workspace: engine, geometry: {} },
    { id: 'two', title: 'Two', slots: [] },
  ], d)
  expect(String((out.pages['workspace']!.slots['clock1'] as { pod: unknown }).pod)).toBe(String(Coord.pod(Coord.parse('implementation', clock), Coord.runtime('main'), 'clock1')))
  expect(strs(out)).toEqual({ pages: {
    workspace: { slots: { clock1: { kind: 'pod', pod: 'example.clock/clock@main/clock1' }, x: { kind: 'view', view: 'nano-explorer' } }, layout: { root: { type: 'row' }, 'window-style': 'clear' }, meta: { title: 'Main', icon: 'home', order: 0, saved, 'saved.template': null } },
    two: { slots: {}, meta: { title: 'Two', order: 1 } },
  } })
})

test('legacyPages: a layout\'s pages; else the legacy Main from its dock\'s panels, else its slots; else none', () => {
  expect(legacyPages({ pages: [{ id: 'p', title: 'P', slots: [] }, { id: 'bad id', title: 'B', slots: [] }] }, d)).toEqual([{ id: 'p', title: 'P', slots: [] }])
  const workspace = { root: { type: 'row', content: [{ type: 'component', componentState: { widget: clock, name: 'a' } }] } }
  expect(legacyPages({ workspace, slots: [{ id: 'clock1', runtime: 'main', pod: 'clock1' }] }, d)).toEqual([{ id: 'workspace', title: 'Workspace', slots: [{ id: 'a', runtime: 'side', pod: 'a' }], workspace }])
  expect(legacyPages({ slots: [{ id: 'clock1', runtime: 'main', pod: 'clock1' }], geometry: {} }, d)).toEqual([{ id: 'workspace', title: 'Workspace', slots: [{ id: 'clock1', runtime: 'main', pod: 'clock1' }] }])
  expect(legacyPages({ desk: {} }, d)).toEqual([])
})

test('opened: a bundle as its parts; a plain nano.json without its old pages, migrated; a malformed bundle refused', () => {
  const pages = { pages: { workspace: { slots: { c: { kind: 'pod', pod: 'example.clock/clock@main/clock1' } } } } }
  const b = opened({ app: { ...d, layout: { desk: 1 } }, platform: pages })
  expect(b.ok && strs(b.value)).toEqual({ app: { ...d, layout: { desk: 1 } }, pages })
  const p = opened({ ...d, layout: { desk: 1, slots: [{ id: 'c', runtime: 'main', pod: 'clock1' }], geometry: {} } })
  expect(p.ok && strs(p.value)).toEqual({ app: { ...d, layout: { desk: 1 } }, pages: { pages: { workspace: { slots: { c: { kind: 'pod', pod: 'example.clock/clock@main/clock1' } }, meta: { title: 'Workspace', order: 0 } } } } })
  const bare = opened({ ...d, layout: { pages: [] } })
  expect(bare.ok && strs(bare.value)).toEqual({ app: d, pages: { pages: {} } })
  expect(opened({ app: d, platform: { pages: { p: { slots: { s: { kind: 'pod', pod: 'no' } } } } } })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
})
