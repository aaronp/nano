// The nav as the Outline's tree: rows indented by level, expand/collapse (local), Add child, Remove (asks for a
// subtree), and moves by keyboard (Alt+arrows, announced) and drag (nest, reorder, never into its own subtree).
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import { bootWorkspacePages } from '../src/components/workspace-pages.ts'
import { walk } from '../src/lib/pages.ts'
import { Application, AppDeployment, Registry, type NanoResult } from '@pritzlaff/nano-core'
import { Outline, type Page } from '@pritzlaff/nano-outline'

localStorage.clear()
location.hash = '#/p/workspace'
document.body.innerHTML = `<app-shell><span slot="title">Nano</span>
  <div slot="nav" class="nav-row" data-workspaces><a href="#/p/workspace">Workspaces</a></div>
  <app-route path="/p/workspace"><div class="ws-page"><c-wires>
    <workspace-dock id="workspace" storage-key="main"><template data-widget="a"></template></workspace-dock>
  </c-wires></div></app-route><app-route path="*"></app-route></app-shell>`

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const registry = Registry.create(), app = must(await Application.create(must(AppDeployment.assemble({ pods: {}, runtimes: {} }, registry))))
const notes = { n: { kind: 'tool' as const, tool: 'notes' } }
const pages: Record<string, Page> = {
  workspace: { title: 'Main', slots: {}, children: ['kid'] }, kid: { title: 'Kid', slots: {} },
  lab: { title: 'Lab', slots: notes, children: ['a'] }, a: { title: 'A', slots: {}, children: ['b'] }, b: { title: 'B', slots: {} },
  two: { title: 'Two', slots: {} },
}
const outline = Outline.create(app, registry, { roots: ['workspace', 'lab', 'two'], pages })
let applies = 0
outline.listen(() => applies++)
bootWorkspacePages(document, outline)

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!
const row = (id: string) => $(`[data-saved="${id}"]`)
const order = () => [...document.querySelectorAll<HTMLElement>('[data-saved]')].map(r => r.dataset.saved)
const shown = () => [...document.querySelectorAll<HTMLElement>('[data-saved]')].filter(r => !r.hidden).map(r => r.dataset.saved)
const levels = () => [...document.querySelectorAll<HTMLElement>('[data-saved]')].map(r => r.dataset.level)
const d = () => outline.document().doc
const kids = (id: string) => d().pages[id]!.children ?? []
const routes = () => [...document.querySelectorAll('app-route')].map(r => r.getAttribute('path'))
const live = () => $('[aria-live="polite"]').textContent
const wait = () => new Promise(r => setTimeout(r, 60))
const alt = (id: string, key: string) => row(id).querySelector('[data-handle]')!.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }))
const go = (hash: string) => { location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')) }

test("the nav shows the tree: Main's row synced like the others, children indented under their parent, a toggle on a parent", () => {
  expect(order()).toEqual(['workspace', 'kid', 'lab', 'a', 'b', 'two'])
  expect($('[data-workspaces]').dataset.saved).toBe('workspace')
  expect($('[data-workspaces] [data-name]').textContent).toBe('Main')
  expect(levels()).toEqual(['1', '2', '1', '2', '3', '1'])
  const t = row('lab').querySelector('[data-toggle]')!
  expect(t.getAttribute('aria-expanded')).toBe('true')
  expect(t.getAttribute('aria-label')).toBe('Pages under Lab')
  expect(row('two').querySelector<HTMLElement>('[data-toggle]')!.hidden).toBe(true)
  expect(row('workspace').querySelector('[data-toggle]')!.hasAttribute('hidden')).toBe(false)
  expect(row('workspace').querySelector('[data-handle]')).toBeNull()   // Main does not move
  expect(row('b').querySelector('a')!.textContent).toBe('B, level 3')   // a screen reader hears its depth, visually hidden
  expect(row('b').querySelector('a [data-depth]')!.className).toBe('visually-hidden')
})

test('a toggle collapses and expands its subtree, locally (no apply); a collapsed parent of the current route opens', () => {
  const before = applies, t = row('lab').querySelector<HTMLElement>('[data-toggle]')!
  t.click()
  expect(t.getAttribute('aria-expanded')).toBe('false')
  expect(shown()).toEqual(['workspace', 'kid', 'lab', 'two'])
  t.click()
  expect(shown()).toEqual(['workspace', 'kid', 'lab', 'a', 'b', 'two'])
  row('a').querySelector<HTMLElement>('[data-toggle]')!.click(); t.click()
  expect(shown()).toEqual(['workspace', 'kid', 'lab', 'two'])
  go('#/p/b')
  expect(shown()).toEqual(['workspace', 'kid', 'lab', 'a', 'b', 'two'])
  expect(t.getAttribute('aria-expanded')).toBe('true')
  expect(applies).toBe(before)
  expect(JSON.stringify(d())).not.toContain('expanded')
})

test('Alt+→ nests a page as the last child of the sibling above; Alt+← moves it out after its parent; Alt+↑/↓ among siblings; each announced (Review Focus 5)', async () => {
  alt('two', 'ArrowRight')
  expect(kids('lab')).toEqual(['a', 'two']); expect(d().roots).toEqual(['workspace', 'lab'])
  expect(levels()[order().indexOf('two')]).toBe('2')
  expect(row('two').querySelector('a')!.textContent).toBe('Two, level 2')
  expect(document.activeElement).toBe(row('two').querySelector('[data-handle]'))
  await wait(); expect(live()).toBe('Moved Two into Lab')
  const handle = () => row('two').querySelector('[data-handle]')
  alt('two', 'ArrowUp')
  expect(kids('lab')).toEqual(['two', 'a'])
  expect(document.activeElement).toBe(handle())
  await wait(); expect(live()).toBe('Moved Two up')
  alt('two', 'ArrowUp')   // already first: refused, and said
  expect(kids('lab')).toEqual(['two', 'a'])
  await wait(); expect(live()).toBe("Two can't move up")
  alt('two', 'ArrowDown'); expect(kids('lab')).toEqual(['a', 'two'])
  expect(document.activeElement).toBe(handle())
  alt('two', 'ArrowLeft')
  expect(d().roots).toEqual(['workspace', 'lab', 'two']); expect(kids('lab')).toEqual(['a'])
  expect(document.activeElement).toBe(handle())
  await wait(); expect(live()).toBe('Moved Two out of Lab')
  alt('two', 'ArrowLeft')   // a root: refused
  expect(d().roots).toEqual(['workspace', 'lab', 'two'])
  await wait(); expect(live()).toBe("Two can't move out")
  expect(handle()!.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight')
  alt('lab', 'ArrowUp')   // Main's place: refused
  expect(d().roots[0]).toBe('workspace')
})

test("a move keeps the page's id, route, slots and dock (Review Focus 1)", () => {
  const dock = $('app-route[path="/p/lab"] workspace-dock')
  alt('lab', 'ArrowRight')   // into Main
  expect(kids('workspace')).toEqual(['kid', 'lab'])
  expect(d().pages['lab']!.slots).toEqual(notes)
  expect(row('lab').querySelector('a')!.getAttribute('href')).toBe('#/p/lab')
  expect($('app-route[path="/p/lab"] workspace-dock')).toBe(dock)
  expect(dock.id).toBe('ws_lab')
  alt('lab', 'ArrowLeft')
  expect(d().roots).toEqual(['workspace', 'lab', 'two'])
})

const rect = (id: string) => Object.assign(row(id), { getBoundingClientRect: () => ({ top: 0, height: 40, bottom: 40, left: 0, right: 0, width: 0, x: 0, y: 0 }) })
const drag = (from: string, to: string, y: number) => {
  rect(to)
  row(from).querySelector('[data-handle]')!.dispatchEvent(new MouseEvent('dragstart', { bubbles: true }))
  const over = new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: y })
  row(to).querySelector('a')!.dispatchEvent(over)
  const mark = row(to).dataset.drop
  row(to).querySelector('a')!.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: y }))
  document.dispatchEvent(new MouseEvent('dragend', { bubbles: true }))
  return { accepted: over.defaultPrevented, mark }
}

test("drag onto a row's middle nests it (the last child); near its edge reorders before or after it, at that row's level", () => {
  expect(drag('two', 'a', 20)).toEqual({ accepted: true, mark: 'inside' })
  expect(kids('a')).toEqual(['b', 'two'])
  expect(drag('two', 'lab', 2)).toEqual({ accepted: true, mark: 'before' })
  expect(d().roots).toEqual(['workspace', 'two', 'lab']); expect(kids('a')).toEqual(['b'])
  expect(drag('two', 'kid', 38)).toEqual({ accepted: true, mark: 'after' })
  expect(kids('workspace')).toEqual(['kid', 'two'])
  drag('two', 'lab', 38)   // after a parent shown open: where its first child shows
  expect(kids('lab')).toEqual(['two', 'a'])
  alt('two', 'ArrowLeft')
  expect(d().roots).toEqual(['workspace', 'lab', 'two'])
  expect(walk(d())).toEqual(['workspace', 'kid', 'lab', 'a', 'b', 'two'])
})

test('a drop after a collapsed parent puts the page after its subtree, at its level', () => {
  const t = row('lab').querySelector<HTMLElement>('[data-toggle]')!
  t.click()
  drag('two', 'kid', 38); drag('two', 'lab', 38)
  expect(d().roots).toEqual(['workspace', 'lab', 'two']); expect(kids('lab')).toEqual(['a'])
  t.click()
})

test("a drop into the row's own subtree is refused, as is one before Main", () => {
  const before = applies
  for (const [to, y] of [['lab', 20], ['a', 20], ['b', 2], ['b', 38]] as const) expect(drag('lab', to, y)).toEqual({ accepted: false, mark: undefined })
  expect(drag('two', 'workspace', 2).mark).toBeUndefined()
  expect(applies).toBe(before)
  expect(d().roots).toEqual(['workspace', 'lab', 'two'])
})

test('in edit mode, Add child makes an empty page the last child of its row, opens the parent, goes there and starts its rename; + still adds a root', () => {
  $('[data-edit-nav]').click()
  row('a').querySelector<HTMLElement>('[data-toggle]')!.click()   // collapsed: the new child opens it
  const add = row('a').querySelector<HTMLElement>('[data-add-child]')!
  expect(add.getAttribute('aria-label')).toBe('Add a page under A')
  add.click()
  expect(kids('a')).toEqual(['b', 'new-workspace'])
  expect(location.hash).toBe('#/p/new-workspace')
  expect(routes()).toContain('/p/new-workspace')
  expect(row('new-workspace').hidden).toBe(false)
  expect($('input[data-rename]').closest('[data-saved]')!.getAttribute('data-saved')).toBe('new-workspace')
  $<HTMLInputElement>('input[data-rename]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  $('[data-new-workspace]').click()
  expect(d().roots.at(-1)).toBe('new-workspace-2')
  $<HTMLInputElement>('input[data-rename]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
})

test('Remove: a leaf goes at once; Main offers none', () => {
  expect(row('workspace').querySelector('[data-remove]')).toBeNull()
  const r = row('new-workspace-2').querySelector<HTMLElement>('[data-remove]')!
  expect(r.getAttribute('aria-label')).toBe('Remove New workspace')
  r.click()
  expect(d().pages['new-workspace-2']).toBeUndefined()
  expect(routes()).not.toContain('/p/new-workspace-2')
  expect(document.activeElement).toBe(row('two').querySelector('[data-name]'))   // the row before it
})

test('Remove of a page with children asks, then removes its subtree, its routes, pods left alone; its route goes to Main (Review Focus 3)', async () => {
  const deployed = JSON.stringify(app.deployment())
  go('#/p/b')
  row('lab').querySelector<HTMLElement>('[data-remove]')!.click()
  const dialog = () => document.querySelector('dialog')
  expect(dialog()!.textContent).toContain('Remove Lab and its 3 pages?')
  dialog()!.querySelector<HTMLElement>('[data-cancel]')!.click(); await wait()
  expect(d().pages['lab']).toBeDefined()
  row('lab').querySelector<HTMLElement>('[data-remove]')!.click()
  dialog()!.querySelector<HTMLElement>('[data-ok]')!.click(); await wait()
  expect(Object.keys(d().pages).sort()).toEqual(['kid', 'two', 'workspace'])
  expect(order()).toEqual(['workspace', 'kid', 'two'])
  expect(routes()).toEqual(['/p/workspace', '/p/kid', '/p/two', '*'])
  expect(location.hash).toBe('#/p/workspace')
  expect(JSON.stringify(app.deployment())).toBe(deployed)
  expect(document.activeElement).toBe(row('kid').querySelector('[data-name]'))
})
