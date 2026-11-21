// Migration into the Outline: the old keys, a document's `layout.pages`, the legacy Main layout, and a file as opened.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import { Coord, type AppDeployment } from '@pritzlaff/nano-core'
import { Outline } from '@pritzlaff/nano-outline'
import { keyed, legacyPages, oldPages, opened, toOutline, treed, withOldDocks } from '../src/migrate.ts'

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

test('toOutline: pod slots by coordinate (the deployment\'s implementation), tool slots (a widget id read as its tool), title, icon and restore point in meta.workspace, each page a root in order, the dock state its layout.workspace, the title its title', () => {
  const saved = { root: { type: 'column' } }, engine = { root: { type: 'row' }, 'window-style': 'clear', saved, 'saved.template': null }
  const out = toOutline([
    { id: 'workspace', title: 'Main', icon: 'home', slots: [{ id: 'clock1', runtime: 'main', pod: 'clock1' }, { id: 'x', view: 'nano-explorer' }, { id: 'gone', runtime: 'main', pod: 'gone' }], workspace: engine, geometry: {} },
    { id: 'two', title: 'Two', slots: [] },
  ], d)
  expect(String((out.pages['workspace']!.slots['clock1'] as { pod: unknown }).pod)).toBe(String(Coord.pod(Coord.parse('implementation', clock), Coord.runtime('main'), 'clock1')))
  expect(strs(out)).toEqual({ roots: ['workspace', 'two'], pages: {
    workspace: { title: 'Main', slots: { clock1: { kind: 'pod', pod: 'example.clock/clock@main/clock1' }, x: { kind: 'tool', tool: 'systems' } }, layout: { workspace: { root: { type: 'row' }, 'window-style': 'clear' } }, meta: { workspace: { icon: 'home', saved, 'saved.template': null } } },
    two: { title: 'Two', slots: {} },
  } })
})

test('legacyPages: a layout\'s pages; else the legacy Main from its dock\'s panels, else its slots; else none', () => {
  expect(legacyPages({ pages: [{ id: 'p', title: 'P', slots: [] }, { id: 'bad id', title: 'B', slots: [] }] }, d)).toEqual([{ id: 'p', title: 'P', slots: [] }])
  const workspace = { root: { type: 'row', content: [{ type: 'component', componentState: { widget: clock, name: 'a' } }] } }
  expect(legacyPages({ workspace, slots: [{ id: 'clock1', runtime: 'main', pod: 'clock1' }] }, d)).toEqual([{ id: 'workspace', title: 'Workspace', slots: [{ id: 'a', runtime: 'side', pod: 'a' }], workspace }])
  expect(legacyPages({ slots: [{ id: 'clock1', runtime: 'main', pod: 'clock1' }], geometry: {} }, d)).toEqual([{ id: 'workspace', title: 'Workspace', slots: [{ id: 'clock1', runtime: 'main', pod: 'clock1' }] }])
  expect(legacyPages({ desk: {} }, d)).toEqual([])
})

test('opened: a bundle as its parts (an old layout as the workspace\'s, a host part as views and layout); a plain nano.json without its old pages, migrated; a malformed bundle refused', () => {
  const pages = { roots: ['workspace'], pages: { workspace: { slots: { c: { kind: 'pod', pod: 'example.clock/clock@main/clock1' } } } } }
  const b = opened({ app: { ...d, layout: { desk: 1 } }, platform: pages })
  expect(b.ok && strs(b.value)).toEqual({ app: { ...d, layout: { workspace: { desk: 1 } } }, pages })
  const host = { views: { clock1: 'x-clock' }, layout: { workspace: { desk: 2 }, react: { k: 1 } } }
  const h = opened({ app: d, outline: pages, host })
  expect(h.ok && strs(h.value)).toEqual({ app: { ...d, ...host }, pages })
  const p = opened({ ...d, layout: { desk: 1, slots: [{ id: 'c', runtime: 'main', pod: 'clock1' }], geometry: {} } })
  expect(p.ok && strs(p.value)).toEqual({ app: { ...d, layout: { workspace: { desk: 1 } } }, pages: { roots: ['workspace'], pages: { workspace: { title: 'Workspace', slots: { c: { kind: 'pod', pod: 'example.clock/clock@main/clock1' } } } } } })
  const bare = opened({ ...d, layout: { pages: [] } })
  expect(bare.ok && strs(bare.value)).toEqual({ app: d, pages: { roots: [], pages: {} } })
  for (const bad of [null, 3, 'x']) expect(opened(bad)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  expect(opened({ app: d, platform: { pages: { p: { slots: { s: { kind: 'pod', pod: 'no' } } } } } })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
})

test('keyed: an old-shape bundle opened is moved; an unknown layout key stays; meta.title stays beside a set title; a keyed page as it is', () => {
  const old = { slots: {}, layout: { root: { type: 'row' }, 'window-style': 'glass', react: { columns: 2 } }, meta: { title: 'Old', icon: 'star', order: 1, other: 3 } }
  const moved = { title: 'Old', slots: {}, layout: { react: { columns: 2 }, workspace: { root: { type: 'row' }, 'window-style': 'glass' } }, meta: { other: 3, workspace: { icon: 'star', order: 1 } } }
  const b = opened({ app: d, platform: { pages: { old } } })
  expect(b.ok && strs(b.value.pages)).toEqual({ roots: ['old'], pages: { old: { ...moved, meta: { other: 3, workspace: { icon: 'star' } } } } })   // and its order is the tree's
  expect(keyed({ slots: {}, meta: { title: 'Meta' }, title: 'Set' })).toEqual({ slots: {}, meta: { title: 'Meta' }, title: 'Set' })
  const only = { slots: {}, layout: { workspace: { root: null } } }
  expect(keyed(only)).toBe(only)
  expect(keyed(moved)).toBe(moved)
})

const parsed = (w: unknown) => { const r = Outline.parse(w); if (!r.ok) throw new Error(r.fail.reason); return r.value }

test('treed: a flat document or one with meta.workspace.order becomes a tree once: the roots in that order, Main first, the order dropped, nothing else lost', () => {
  const flatOld = { pages: { b: { slots: {}, meta: { workspace: { order: 2, icon: 'star' }, react: 1 } }, none: { slots: {} }, workspace: { slots: {}, meta: { workspace: { order: 5 } } }, a: { slots: {}, meta: { order: 1 } } } }
  expect(strs(treed(parsed(flatOld)))).toEqual({ roots: ['workspace', 'a', 'b', 'none'], pages: { b: { slots: {}, meta: { workspace: { icon: 'star' }, react: 1 } }, none: { slots: {} }, workspace: { slots: {} }, a: { slots: {} } } })
  const tree = parsed({ roots: ['workspace', 'a'], pages: { workspace: { slots: {} }, a: { slots: {}, children: ['b'] }, b: { slots: {} } } })
  expect(treed(tree)).toEqual(tree)   // a tree already: as it is
  const under = treed(parsed({ roots: ['a'], pages: { a: { slots: {}, children: ['workspace'] }, workspace: { slots: {} } } }))
  expect(under.roots).toEqual(['workspace', 'a'])
  expect(Object.keys(under.pages['a']!)).toEqual(['slots'])   // Main moved out: no empty children list left
})

test('opened: an { app, outline } bundle, an { app, platform } bundle with the old order and a plain nano.json load into the same tree', () => {
  const pages = { pages: { workspace: { slots: {}, meta: { workspace: { order: 0 } } }, two: { title: 'Two', slots: {}, meta: { workspace: { order: 2 } } }, one: { title: 'One', slots: {}, meta: { workspace: { order: 1 } } } } }
  const tree = { roots: ['workspace', 'one', 'two'], pages: { workspace: { slots: {} }, two: { title: 'Two', slots: {} }, one: { title: 'One', slots: {} } } }
  const old = opened({ app: d, platform: pages }), now = opened({ app: d, outline: tree })
  expect(old.ok && strs(old.value)).toEqual({ app: d, pages: tree })
  expect(now.ok && strs(now.value)).toEqual({ app: d, pages: tree })
  const plain = opened({ ...d, layout: { pages: [{ id: 'one', title: 'One', slots: [] }, { id: 'workspace', title: 'W', slots: [] }] } })
  expect(plain.ok && plain.value.pages.roots).toEqual(['workspace', 'one'])
  expect(opened({ app: d, outline: { pages: { p: { slots: { s: { kind: 'pod', pod: 'no' } } } } } })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
})

test('opened: an { app, outline } bundle\'s view slot (a widget id) is its tool\'s slot', () => {
  const o = opened({ app: d, outline: { roots: ['workspace'], pages: { workspace: { slots: { x: { kind: 'view', view: 'nano-explorer' }, n: { kind: 'view', view: 'notes' } } } } } })
  expect(o.ok && strs(o.value.pages.pages['workspace']!.slots)).toEqual({ x: { kind: 'tool', tool: 'systems' }, n: { kind: 'tool', tool: 'notes' } })
})
