// Workspace pages shown from the Outline: mount and unmount, + beside the title, the nav's edit mode (rename keeps the id,
// icon, reorder: the tree's order) and Save as (the source's next sibling), each one `outline.apply`.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import { flat } from './flat.ts'
import { bootWorkspacePages, mountWorkspace } from '../src/components/workspace-pages.ts'
import { move, walk } from '../src/lib/pages.ts'
import { Application, AppDeployment, Registry, type NanoResult } from '@pritzlaff/nano-core'
import { Outline, type Page } from '@pritzlaff/nano-outline'

localStorage.clear()
document.body.innerHTML = `<app-shell><span slot="title">Nano</span>
  <div slot="nav" class="nav-row" data-workspaces><a href="#/workspace">Workspaces</a></div>
  <app-route path="/workspace"><div class="ws-page"><c-wires>
    <workspace-dock id="workspace" storage-key="main"><template data-widget="a"></template><template data-widget="b"></template></workspace-dock>
  </c-wires></div></app-route><app-route path="*"></app-route></app-shell>`
const template = { template: 'one', order: [{ widget: 'a' }], dock: { root: null } }
Object.assign(document.querySelector('#workspace')!, { arrangement: () => ({ root: { type: 'row' }, template }) })

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const registry = Registry.create(), app = must(await Application.create(must(AppDeployment.assemble({ pods: {}, runtimes: {} }, registry))))
const outline = Outline.create(app, registry, flat({ workspace: { title: 'Workspace', slots: {} } }))
let applies = 0
outline.listen(() => applies++)
bootWorkspacePages(document, outline)
const doc = () => JSON.parse(JSON.stringify(outline.document().doc)) as { pages: Record<string, Page & { meta: { workspace: Record<string, unknown> } }> }
const page = (id: string) => doc().pages[id]
/** A page as the nav shows it: its id, title and icon. */
const row = (id: string) => { const p = page(id)!, m = p.meta.workspace; return { id, title: p.title, ...(m.icon !== undefined && { icon: m.icon }) } }
const ids = () => walk(outline.document().doc)
const routes = () => [...document.querySelectorAll('app-route')].map(r => r.getAttribute('path'))
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!
const input = () => $<HTMLInputElement>('input[data-rename]')
const type = (value: string, key: string) => { input().value = value; input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) }
const editing = () => $('app-shell').hasAttribute('data-editing')
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const savedOrder = () => [...document.querySelectorAll<HTMLElement>('[data-saved]')].map(r => r.dataset.saved)

test('mountWorkspace adds a nav row and a route before the not-found page, with a dock of Main\'s widgets', () => {
  mountWorkspace(document, { id: 'lab', title: 'Lab', icon: 'star' })
  const row = $('[data-saved="lab"]')
  expect(row.previousElementSibling?.hasAttribute('data-workspaces')).toBe(true)
  expect(row.querySelector('a')!.getAttribute('href')).toBe('#/lab')
  expect(row.querySelector('[data-handle]')!.getAttribute('aria-label')).toBe('Move Lab')
  expect(row.querySelector('[data-duplicate], [data-edit]')).toBeNull()
  expect(routes()).toEqual(['/workspace', '/lab', '*'])
  const dock = $('app-route[path="/lab"] workspace-dock')
  expect(dock.id).toBe('ws_lab')
  expect(dock.getAttribute('storage-key')).toBe('lab')
  expect([...dock.querySelectorAll('template')].map(t => t.dataset.widget)).toEqual(['a', 'b'])
  row.remove(); $('app-route[path="/lab"]').remove()
})

test('the title holds + and ✎; + makes an empty page, goes there and starts its rename; a second is numbered', () => {
  expect($('[slot="title"] [data-new-workspace]').getAttribute('aria-label')).toBe('New workspace')
  expect($('[slot="title"] [data-edit-nav]').getAttribute('aria-pressed')).toBe('false')
  $('[data-new-workspace]').click()
  expect(location.hash).toBe('#/new-workspace')
  expect(ids().slice(1)).toEqual(['new-workspace'])
  expect(page('new-workspace')).toEqual({ title: 'New workspace', slots: {}, meta: { workspace: { icon: 'window' } } })
  expect(routes()).toEqual(['/workspace', '/new-workspace', '*'])
  expect(input().closest('[data-saved]')!.getAttribute('data-saved')).toBe('new-workspace')
  type('', 'Escape')
  $('[data-new-workspace]').click()
  expect(page('new-workspace-2')).toEqual({ title: 'New workspace', slots: {}, meta: { workspace: { icon: 'window' } } })
  type('Desk', 'Escape')
  expect($('[data-saved="new-workspace-2"] [data-name]').textContent).toBe('New workspace')
})

test('✎ toggles edit mode, making names and icons buttons; Esc leaves it, unless handled or in a dialog', () => {
  $('[data-edit-nav]').click()
  expect(editing()).toBe(true)
  expect($('[data-edit-nav]').getAttribute('aria-pressed')).toBe('true')
  expect($('[data-workspaces] [data-name]').getAttribute('role')).toBe('button')
  expect($('[data-saved="new-workspace"] [data-glyph]').getAttribute('tabindex')).toBe('0')
  const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }); handled.preventDefault()
  document.dispatchEvent(handled)
  document.body.insertAdjacentHTML('beforeend', '<dialog><button id="in-dialog"></button></dialog>')
  key($('#in-dialog'), 'Escape'); $('dialog').remove()
  expect(editing()).toBe(true)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  expect(editing()).toBe(false)
  expect($('[data-workspaces] [data-name]').hasAttribute('role')).toBe(false)
  $('[data-edit-nav]').click()
})

test('in edit mode a link click does not navigate; Enter on a focused name opens its input', () => {
  const click = new MouseEvent('click', { bubbles: true, cancelable: true })
  $('[data-saved="new-workspace"] a').dispatchEvent(click)
  expect(click.defaultPrevented).toBe(true)
  $('[data-saved="new-workspace"] [data-name]').focus()
  key(document.activeElement!, 'Enter')
  expect(input().closest('[data-saved]')!.getAttribute('data-saved')).toBe('new-workspace')
  type('', 'Escape')
  expect(document.activeElement).toBe($('[data-saved="new-workspace"] [data-name]'))
  $('[data-saved="new-workspace"] [data-name]').click()
  $('[data-edit-nav]').focus()   // blur: kept, and focus stays where it went
  expect(document.activeElement).toBe($('[data-edit-nav]'))
})

test('a rename changes the title only, in one apply: the id, route, hash, dock and its key stay (Review Focus 4)', () => {
  location.hash = '#/new-workspace'
  $('[data-saved="new-workspace"] [data-name]').click()
  const before = applies
  type('Desk', 'Enter')
  expect(applies).toBe(before + 1)
  expect(page('new-workspace')!.title).toBe('Desk')
  expect(ids()).toEqual(['workspace', 'new-workspace', 'new-workspace-2'])
  expect($('[data-saved="new-workspace"] a').getAttribute('href')).toBe('#/new-workspace')
  expect($('[data-saved="new-workspace"] [data-name]').textContent).toBe('Desk')
  expect(routes()).toEqual(['/workspace', '/new-workspace', '/new-workspace-2', '*'])
  const dock = $('app-route[path="/new-workspace"] workspace-dock')
  expect(dock.getAttribute('storage-key')).toBe('new-workspace')
  expect(dock.id).toBe('ws_new-workspace')
  expect(location.hash).toBe('#/new-workspace')
})

test('a second page with the same title is fine; Esc or an empty name keeps the old', () => {
  $('[data-saved="new-workspace-2"] [data-name]').click()
  type('Desk', 'Enter')
  expect(ids().map(id => page(id)!.title)).toEqual(['Workspace', 'Desk', 'Desk'])
  expect(document.activeElement).toBe($('[data-saved="new-workspace-2"] [data-name]'))
  $('[data-saved="new-workspace-2"] [data-name]').click()
  type('Other', 'Escape')
  expect(editing()).toBe(true)
  $('[data-saved="new-workspace-2"] [data-name]').click()
  type('  ', 'Enter')
  expect($('[data-saved="new-workspace-2"] [data-name]').textContent).toBe('Desk')
  expect(row('new-workspace-2')).toEqual({ id: 'new-workspace-2', title: 'Desk', icon: 'window' })
})

test('Enter on the icon opens a grid of icons (arrows move, focus leaving closes); choosing one updates the row', () => {
  $('[data-saved="new-workspace"] [data-glyph]').focus(); key(document.activeElement!, 'Enter')
  let pop = $('[role="listbox"]')
  expect(document.activeElement!.getAttribute('data-icon')).toBe('window')
  key(document.activeElement!, 'ArrowRight')
  expect(document.activeElement).toBe(pop.querySelector('[data-icon="window"]')!.nextElementSibling)
  $('[data-edit-nav]').focus()
  expect(document.querySelector('[role="listbox"]')).toBeNull()
  $('[data-saved="new-workspace"] a svg').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  pop = $('[role="listbox"]')
  expect(pop.querySelector('[aria-selected="true"]')!.getAttribute('data-icon')).toBe('window')
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  pop.querySelector('[data-icon="rocket"]')!.dispatchEvent(down)
  expect(down.defaultPrevented).toBe(true)   // focus stays inside, so no focusout closes it before the click
  pop.querySelector<HTMLElement>('[data-icon="rocket"]')!.click()
  expect(document.querySelector('[role="listbox"]')).toBeNull()
  expect(page('new-workspace')!.meta.workspace.icon).toBe('rocket')
  expect($('[data-saved="new-workspace"] a').dataset.icon).toBe('rocket')
})

test('clicking a focused icon commits it, though removing the grid fires focusout (as Chromium does)', () => {
  $('[data-saved="new-workspace"] [data-glyph]').focus(); key(document.activeElement!, 'Enter')
  const pop = $('[role="listbox"]'), rocket = pop.querySelector<HTMLElement>('[aria-selected="false"]')!, icon = rocket.dataset.icon!
  rocket.focus()
  // Chromium: removing the focused grid fires focusout first; a handler that removes it then makes the outer removal throw
  const remove = pop.remove.bind(pop); let removing = false
  pop.remove = () => {
    if (removing) return remove()
    removing = true; rocket.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null })); removing = false
    if (!pop.isConnected) throw new DOMException('The node to be removed is no longer a child of this node.', 'NotFoundError')
    remove()
  }
  rocket.click()
  expect(document.querySelector('[role="listbox"]')).toBeNull()
  expect(page('new-workspace')!.meta.workspace.icon).toBe(icon)
})

test('Alt+↓ on a handle moves the page down (the roots rewritten, one apply), in the nav, and says so; Main has no handle and cannot move', async () => {
  const before = applies
  $('[data-saved="new-workspace"] [data-handle]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }))
  expect(applies).toBe(before + 1)
  expect(ids()).toEqual(['workspace', 'new-workspace-2', 'new-workspace'])
  expect(outline.document().doc.roots).toEqual(['workspace', 'new-workspace-2', 'new-workspace'])
  expect(savedOrder()).toEqual(['new-workspace-2', 'new-workspace'])
  await new Promise(r => setTimeout(r, 60))
  expect($('[aria-live="polite"]').textContent).toBe('Moved Desk down')
  $('[data-saved="new-workspace-2"] [data-handle]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }))
  expect(ids()[0]).toBe('workspace')   // up from the first saved page is Main's place: refused
  expect(document.querySelector('[data-workspaces] [data-handle]')).toBeNull()
  expect(move(outline.document().doc, 'workspace', undefined, 1)).toBeUndefined()
  expect(move(outline.document().doc, 'new-workspace', undefined, 0)).toBeUndefined()
})

test("Main's rename is kept with its icon, and its id and route stay", () => {
  $('[data-workspaces] [data-name]').click()
  type('Home', 'Enter')
  expect(row('workspace')).toMatchObject({ id: 'workspace', title: 'Home' })
  expect($('[data-workspaces] [data-name]').textContent).toBe('Home')
  expect($('[data-workspaces] a').dataset.icon).toBe('panels')
})

test('a page added through the Outline (as a pod would) appears in the nav and routes; a title change relabels; removing unmounts', () => {
  const put = (id: string, p?: Page) => { const { [id]: _, ...rest } = outline.document().doc.pages; must(outline.apply(flat(p ? { ...rest, [id]: p } : rest))) }
  put('pod-made', { title: 'Pod made', slots: {}, meta: { workspace: { icon: 'star' } } })
  expect($('[data-saved="pod-made"] [data-name]').textContent).toBe('Pod made')
  expect(routes()).toContain('/pod-made')
  expect(ids().at(-1)).toBe('pod-made'); expect(savedOrder().at(-1)).toBe('pod-made')
  put('pod-made', { title: 'Renamed', slots: {}, meta: { workspace: { icon: 'star' } } })
  expect($('[data-saved="pod-made"] [data-name]').textContent).toBe('Renamed')
  expect($('[data-saved="pod-made"] a').getAttribute('href')).toBe('#/pod-made')
  location.hash = '#/pod-made'
  put('pod-made')
  expect(document.querySelector('[data-saved="pod-made"]')).toBeNull()
  expect(routes()).not.toContain('/pod-made')
  expect(location.hash).toBe('#/workspace')
})

test('Save as workspace copies the page only (not its children) into "<title> copy" (same slots, its arrangement as the page\'s `layout.workspace`, a new id), its next sibling, and starts its rename', () => {
  const d = outline.document().doc
  must(outline.apply({ ...d, pages: { ...d.pages, workspace: { ...d.pages['workspace']!, children: ['kid'] }, kid: { slots: {} } } }))
  $('#workspace').dispatchEvent(new CustomEvent('dock:save-as', { bubbles: true }))
  expect(outline.document().doc.roots.slice(0, 2)).toEqual(['workspace', 'home-copy'])
  expect(page('home-copy')).toEqual({ title: 'Home copy', slots: {}, layout: { workspace: { root: { type: 'row' }, template } }, meta: { workspace: { icon: 'panels' } } })
  const now = outline.document().doc, { kid: _, ...rest } = now.pages
  must(outline.apply({ ...now, pages: { ...rest, workspace: { ...rest['workspace']!, children: [] } } }))
  expect(location.hash).toBe('#/home-copy')
  expect(input().closest('[data-saved]')!.getAttribute('data-saved')).toBe('home-copy')
  type('', 'Escape')
})

test('a new page\'s id avoids every page\'s id, not only mounted routes: another client\'s `inbox` (at /p/inbox) and a page whose route is not mounted stay as they are', () => {
  const inbox = { title: 'Inbox', slots: { n: { kind: 'view' as const, view: 'notes' } }, meta: { other: 1 } }
  must(outline.apply(flat({ ...outline.document().doc.pages, inbox })))
  expect(routes()).toContain('/p/inbox')
  const copy = page('home-copy')
  $('app-route[path="/home-copy"]').remove()   // its route not mounted (yet)
  $('#workspace').dispatchEvent(new CustomEvent('dock:save-as', { bubbles: true }))
  type('', 'Escape')
  expect(location.hash).toBe('#/home-copy-2')
  expect(page('home-copy')).toEqual(copy)
  expect(page('inbox') as unknown).toEqual(inbox)
})

test('a page id holding `"` mounts and unmounts: its selectors are escaped', () => {
  const d = outline.document().doc
  must(outline.apply(flat({ ...d.pages, 'q"t': { title: 'Quote', slots: {} } })))
  expect(routes()).toContain('/q"t')
  must(outline.apply(flat(d.pages)))
  expect(routes()).not.toContain('/q"t')
  expect(savedOrder()).not.toContain('q"t')
})
