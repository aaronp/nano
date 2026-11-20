// The workspace keeps to its own keys (ADR-0039): its dock's state in `layout.workspace`, its meta in `meta.workspace`,
// the title `page.title`; other clients' keys kept (Review Focus 1). An old stored document moves once, nothing lost
// (Review Focus 2). A page another client made on one of the workspace's routes opens at `/p/<id>` (Review Focus 3).
import { expect, test } from 'bun:test'
import type { NanoResult } from '@pritzlaff/nano-core'
import type { Page } from '@pritzlaff/nano-outline'
import { host, mount, place, pod, tick, until } from './dock-pods-setup.ts'

const { bootPages } = await import('../src/boot-pages.ts')
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
type GL = { emit(e: string): void }
type Stored = HTMLElement & { storage: Storage }

test('the React host\'s columns survive a workspace visit; a page whose layout holds only `react` opens (Review Focus 1)', async () => {
  const h = await host()
  await place(h, 'main', ['input1'])
  const cols: Page = { title: 'Cols', slots: { a: pod('input1') }, layout: { react: { columns: 3 } }, meta: { react: { x: 1 } } }
  const { go, dock, panels, written } = mount(h, { cols })
  go('cols')
  await until(() => panels('cols').length === 1)
  await tick()
  ;(dock('cols') as unknown as { layout: GL }).layout.emit('stateChanged')   // the dock writes its layout
  await tick()
  const p = written('cols')
  expect(p.layout.react).toEqual({ columns: 3 })
  expect(p.layout.workspace.root).toBeDefined()
  expect(Object.keys(p.layout).sort()).toEqual(['react', 'workspace'])
  expect(p.meta).toEqual({ react: { x: 1 } })
  expect(p.title).toBe('Cols')
})

test('an old stored document moves to the new shape at boot, nothing lost; the workspace reads every field (Review Focus 2)', async () => {
  const h = await host()
  const root = { type: 'row', content: [{ type: 'component', componentType: 'notes', componentState: { widget: 'notes' } }] }
  const template = { template: 'one', order: [{ widget: 'notes' }], parked: [], dock: null }
  const saved = { root: { type: 'column', content: [] } }, savedTemplate = { template: 'two-cols', order: [null, null], parked: [], dock: null }
  const engine = { root, settings: {}, header: {}, dimensions: {}, openPopouts: [], resolved: true }
  const old = { pages: {
    workspace: { slots: {}, meta: { title: 'Home', icon: 'home', order: 0 } },
    lab: { slots: { notes: { kind: 'view', view: 'notes' } }, layout: { ...engine, template, 'window-style': 'glass' },
      meta: { title: 'Lab', icon: 'star', order: 2, saved, 'saved.template': savedTemplate } },
    two: { slots: {}, meta: { title: 'Two', order: 1 } },
  } }
  const booted = must(await bootPages(h, localStorage, null, old))
  expect(JSON.parse(JSON.stringify(booted))).toEqual({ roots: ['workspace', 'two', 'lab'], pages: {   // the old order the roots', dropped
    workspace: { title: 'Home', slots: {}, meta: { workspace: { icon: 'home' } } },
    lab: { title: 'Lab', slots: { notes: { kind: 'view', view: 'notes' } }, layout: { workspace: { ...engine, template, 'window-style': 'glass' } },
      meta: { workspace: { icon: 'star', saved, 'saved.template': savedTemplate } } },
    two: { title: 'Two', slots: {} },
  } })
  expect(must(await bootPages(h, localStorage, null, booted))).toEqual(booted)   // already moved: left as it is
  const { pages } = booted
  mount(h, Object.fromEntries(booted.roots.map(id => [id, pages[id]!])))
  const row = (id: string) => document.querySelector<HTMLElement>(`[data-saved="${id}"] a`)!
  expect([...document.querySelectorAll<HTMLElement>('[data-saved]')].map(r => r.dataset['saved'])).toEqual(['two', 'lab'])   // order
  expect([row('lab').title, row('lab').dataset['icon']]).toEqual(['Lab', 'star'])   // title, icon
  const s = document.querySelector<Stored>('app-route[path="/lab"] workspace-dock')!.storage
  expect(JSON.parse(s.getItem('lab')!).root).toEqual(root)   // dock arrangement
  expect(JSON.parse(s.getItem('lab.template')!)).toEqual(template)
  expect(s.getItem('lab.window-style')).toBe('glass')
  expect(JSON.parse(s.getItem('lab.saved')!)).toEqual(saved)   // restore point
  expect(JSON.parse(s.getItem('lab.saved.template')!)).toEqual(savedTemplate)
})

test('a page `ring` made by another client opens at /p/ring; the Ring page still works (Review Focus 3)', async () => {
  const h = await host()
  document.body.innerHTML = '<app-route path="/ring" hidden><nano-ring-stub></nano-ring-stub></app-route>'
  const stored = { pages: { workspace: { slots: {} }, ring: { title: 'Ring', slots: { notes: { kind: 'view', view: 'notes' } } } } }
  const { pages } = must(await bootPages(h, localStorage, null, stored))
  const { go } = mount(h, pages)
  const routes = [...document.querySelectorAll('app-route')].map(r => r.getAttribute('path'))
  expect(routes.filter(p => p === '/ring')).toHaveLength(1)
  expect(routes).toContain('/p/ring')
  expect(document.querySelector('app-route[path="/ring"] nano-ring-stub')).not.toBeNull()   // the Ring's own route, untouched
  expect(document.querySelector('[data-saved="ring"] a')!.getAttribute('href')).toBe('#/p/ring')
  go('p/ring')
  const panels = () => document.querySelectorAll('app-route[path="/p/ring"] workspace-dock .dock-panel').length
  await until(() => panels() === 1)
})
