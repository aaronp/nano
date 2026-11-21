// boot-pages.ts: `settled` (Main always there and the first root, the pages a tree) and `oldForms` (the workspace's
// old forms, the host core's migrate hook: a pure data edit).
import { expect, test } from 'bun:test'
import { Registry } from '@pritzlaff/nano-core'
import uiProvider from '@pritzlaff/nano-ui'
import { Outline } from '@pritzlaff/nano-outline'
import './host-deploy-setup.ts'

const { settled, oldForms } = await import('../src/boot-pages.ts')
const strs = (v: unknown) => JSON.parse(JSON.stringify(v))
const bootPages = (_h: unknown, _s: Storage, _d: null, stored: unknown) => { const r = Outline.parse(stored); if (!r.ok) throw new Error(r.fail.reason); return { ok: true as const, value: settled(r.value) } }
const must = <T>(r: { ok: true; value: T }) => r.value
const untouched = undefined

test('stored pages saved without Main still boot with Main', () => {
  const r = must(bootPages(untouched, localStorage, null, { pages: { two: { slots: {} } } }))
  expect(strs(r)).toEqual({ roots: ['workspace', 'two'], pages: { two: { slots: {} }, workspace: { title: 'Workspace', slots: {} } } })
})

test('oldForms: the old pages from the layout, their dock pods placed lazy in main, the rest of the layout the workspace\'s', () => {
  const registry = Registry.create(); registry.add(uiProvider)
  localStorage.setItem('workspace-starter.layout', JSON.stringify({ root: { type: 'row', content: [{ type: 'component', componentState: { widget: 'nano-ui-log', name: 'log7' } }] } }))
  const doc = { app: { pods: {}, runtimes: {} }, outline: { roots: [], pages: {} },
    host: { views: { log7: 'nano-log' }, layout: { ring: { show: [] }, pages: [{ id: 'workspace', title: 'Main', slots: [{ id: 'log7', runtime: 'main', pod: 'log7' }] }] } } }
  const out = oldForms(doc, localStorage, registry)
  expect(out.app).toEqual({ pods: { log7: { implementation: 'nano.ui/log', eager: false } }, runtimes: { main: { pods: ['log7'], subscriptions: [] } } })
  expect(strs(out.outline.pages['workspace']!.slots)).toEqual({ log7: { kind: 'pod', pod: 'nano.ui/log@main/log7' } })
  expect(out.host).toEqual({ views: { log7: 'nano-log' }, layout: { workspace: { ring: { show: [] } } } })
  expect(doc.app.pods).toEqual({})   // pure
  localStorage.clear()
})

test('stored pages with Main a child or not first boot repaired: Main the first root, its children kept, nothing else moved', () => {
  const child = { roots: ['a'], pages: { a: { slots: {}, children: ['workspace', 'b'] }, workspace: { slots: {}, children: ['c'] }, b: { slots: {} }, c: { slots: {} } } }
  expect(strs(must(bootPages(untouched, localStorage, null, child)))).toEqual({ roots: ['workspace', 'a'], pages: { a: { slots: {}, children: ['b'] }, workspace: { slots: {}, children: ['c'] }, b: { slots: {} }, c: { slots: {} } } })
  const second = { roots: ['a', 'workspace'], pages: { a: { slots: {} }, workspace: { slots: {} } } }
  expect(must(bootPages(untouched, localStorage, null, second)).roots).toEqual(['workspace', 'a'])
})

test('stored flat pages with the old meta.workspace.order boot as a tree in that order, the order dropped', () => {
  const old = { pages: { two: { title: 'Two', slots: {}, meta: { workspace: { order: 2, icon: 'star' } } }, workspace: { slots: {}, meta: { workspace: { order: 0 } } }, one: { slots: {}, meta: { workspace: { order: 1 } } } } }
  expect(strs(must(bootPages(untouched, localStorage, null, old)))).toEqual({ roots: ['workspace', 'one', 'two'], pages: { two: { title: 'Two', slots: {}, meta: { workspace: { icon: 'star' } } }, workspace: { slots: {} }, one: { slots: {} } } })
})
