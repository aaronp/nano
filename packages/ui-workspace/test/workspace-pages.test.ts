// Workspace pages shown from the page store: mount and unmount, + beside the title, the nav's edit mode (rename keeps the id, icon, reorder) and Save as.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import { bootWorkspacePages, mountWorkspace } from '../src/components/workspace-pages.ts'
import { pageStore } from '../src/lib/pages.ts'

localStorage.clear()
document.body.innerHTML = `<app-shell><span slot="title">Nano</span>
  <div slot="nav" class="nav-row" data-workspaces><a href="#/workspace">Workspaces</a></div>
  <app-route path="/workspace"><div class="ws-page"><c-wires>
    <workspace-dock id="workspace" storage-key="main"><template data-widget="a"></template><template data-widget="b"></template></workspace-dock>
  </c-wires></div></app-route><app-route path="*"></app-route></app-shell>`
const template = { template: 'one', order: [{ widget: 'a' }], dock: { root: null } }
Object.assign(document.querySelector('#workspace')!, { arrangement: () => ({ root: { type: 'row' }, template }) })

const store = pageStore([], () => true)
bootWorkspacePages(document, store)
const ids = () => store.list().map(p => p.id)
const routes = () => [...document.querySelectorAll('app-route')].map(r => r.getAttribute('path'))
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!
const input = () => $<HTMLInputElement>('input[data-rename]')
const type = (value: string, key: string) => { input().value = value; input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) }
const editing = () => $('app-shell').hasAttribute('data-editing')
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const savedOrder = () => [...document.querySelectorAll<HTMLElement>('[data-saved]')].map(r => r.dataset.saved)

test('mountWorkspace adds a nav row and a route before the not-found page, with a dock of Main\'s widgets', () => {
  mountWorkspace(document, { id: 'lab', title: 'Lab', icon: 'star', slots: [] })
  const row = $('[data-saved="lab"]')
  expect(row.previousElementSibling?.hasAttribute('data-workspaces')).toBe(true)
  expect(row.querySelector('a')!.getAttribute('href')).toBe('#/lab')
  expect(row.querySelector('[data-handle]')!.getAttribute('aria-label')).toBe('Move Lab')
  expect(row.querySelector('[data-duplicate], [data-edit]')).toBeNull()
  expect(routes()).toEqual(['/workspace', '/lab', '*'])
  const dock = $('app-route[path="/lab"] workspace-dock')
  expect(dock.id).toBe('ws_lab')
  expect(dock.getAttribute('storage-key')).toBe('main.saved./lab')
  expect([...dock.querySelectorAll('template')].map(t => t.dataset.widget)).toEqual(['a', 'b'])
  row.remove(); $('app-route[path="/lab"]').remove()
})

test('the title holds + and ✎; + makes an empty page, goes there and starts its rename; a second is numbered', () => {
  expect($('[slot="title"] [data-new-workspace]').getAttribute('aria-label')).toBe('New workspace')
  expect($('[slot="title"] [data-edit-nav]').getAttribute('aria-pressed')).toBe('false')
  $('[data-new-workspace]').click()
  expect(location.hash).toBe('#/new-workspace')
  expect(store.list().slice(1)).toEqual([{ id: 'new-workspace', title: 'New workspace', icon: 'window', slots: [] }])
  expect(routes()).toEqual(['/workspace', '/new-workspace', '*'])
  expect(localStorage.getItem('main.saved./new-workspace')).toBeNull()
  expect(input().closest('[data-saved]')!.getAttribute('data-saved')).toBe('new-workspace')
  type('', 'Escape')
  $('[data-new-workspace]').click()
  expect(store.list().at(-1)).toEqual({ id: 'new-workspace-2', title: 'New workspace', icon: 'window', slots: [] })
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

test('a rename changes the title only: the id, route, hash, dock and its key stay (Review Focus 4)', () => {
  localStorage.setItem('main.saved./new-workspace', '{}')
  location.hash = '#/new-workspace'
  $('[data-saved="new-workspace"] [data-name]').click()
  type('Desk', 'Enter')
  expect(store.get('new-workspace')?.title).toBe('Desk')
  expect(ids()).toEqual(['workspace', 'new-workspace', 'new-workspace-2'])
  expect($('[data-saved="new-workspace"] a').getAttribute('href')).toBe('#/new-workspace')
  expect($('[data-saved="new-workspace"] [data-name]').textContent).toBe('Desk')
  expect(routes()).toEqual(['/workspace', '/new-workspace', '/new-workspace-2', '*'])
  const dock = $('app-route[path="/new-workspace"] workspace-dock')
  expect(dock.getAttribute('storage-key')).toBe('main.saved./new-workspace')
  expect(dock.id).toBe('ws_new-workspace')
  expect(localStorage.getItem('main.saved./new-workspace')).toBe('{}')
  expect(location.hash).toBe('#/new-workspace')
})

test('a second page with the same title is fine; Esc or an empty name keeps the old', () => {
  $('[data-saved="new-workspace-2"] [data-name]').click()
  type('Desk', 'Enter')
  expect(store.list().map(p => p.title)).toEqual(['Workspace', 'Desk', 'Desk'])
  expect(document.activeElement).toBe($('[data-saved="new-workspace-2"] [data-name]'))
  $('[data-saved="new-workspace-2"] [data-name]').click()
  type('Other', 'Escape')
  expect(editing()).toBe(true)
  $('[data-saved="new-workspace-2"] [data-name]').click()
  type('  ', 'Enter')
  expect($('[data-saved="new-workspace-2"] [data-name]').textContent).toBe('Desk')
  expect(store.get('new-workspace-2')).toEqual({ id: 'new-workspace-2', title: 'Desk', icon: 'window', slots: [] })
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
  expect(store.get('new-workspace')?.icon).toBe('rocket')
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
  expect(store.get('new-workspace')?.icon).toBe(icon)
})

test('Alt+↓ on a handle moves the page down, by the store\'s index, in the nav, and says so; Main has no handle and cannot move', async () => {
  $('[data-saved="new-workspace"] [data-handle]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }))
  expect(ids()).toEqual(['workspace', 'new-workspace-2', 'new-workspace'])
  expect(savedOrder()).toEqual(['new-workspace-2', 'new-workspace'])
  await new Promise(r => setTimeout(r, 60))
  expect($('[aria-live="polite"]').textContent).toBe('Moved Desk down')
  $('[data-saved="new-workspace-2"] [data-handle]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }))
  expect(ids()[0]).toBe('workspace')   // up from the first saved page is Main's place: refused
  expect(document.querySelector('[data-workspaces] [data-handle]')).toBeNull()
  expect(store.set(store.get('workspace')!, 1)).toMatchObject({ ok: false })
})

test("Main's rename is kept with its icon, and its id and route stay", () => {
  $('[data-workspaces] [data-name]').click()
  type('Home', 'Enter')
  expect(store.get('workspace')).toMatchObject({ id: 'workspace', title: 'Home' })
  expect($('[data-workspaces] [data-name]').textContent).toBe('Home')
  expect($('[data-workspaces] a').dataset.icon).toBe('panels')
})

test('a page added through the store (as a pod would) appears in the nav and routes; a title change relabels; removing unmounts', () => {
  store.set({ id: 'pod-made', title: 'Pod made', icon: 'star', slots: [] })
  expect($('[data-saved="pod-made"] [data-name]').textContent).toBe('Pod made')
  expect(routes()).toContain('/pod-made')
  expect(ids().at(-1)).toBe('pod-made'); expect(savedOrder().at(-1)).toBe('pod-made')
  store.set({ ...store.get('pod-made')!, title: 'Renamed' })
  expect($('[data-saved="pod-made"] [data-name]').textContent).toBe('Renamed')
  expect($('[data-saved="pod-made"] a').getAttribute('href')).toBe('#/pod-made')
  location.hash = '#/pod-made'
  store.remove('pod-made')
  expect(document.querySelector('[data-saved="pod-made"]')).toBeNull()
  expect(routes()).not.toContain('/pod-made')
  expect(location.hash).toBe('#/workspace')
})

test('Save as workspace copies the page into "<title> copy" (same slots, a new id) and starts its rename', () => {
  $('#workspace').dispatchEvent(new CustomEvent('dock:save-as', { bubbles: true }))
  expect(store.list().at(-1)).toEqual({ id: 'home-copy', title: 'Home copy', icon: 'panels', slots: [] })
  expect(JSON.parse(localStorage.getItem('main.saved./home-copy')!)).toEqual({ root: { type: 'row' } })
  expect(JSON.parse(localStorage.getItem('main.saved./home-copy.template')!)).toEqual(template)
  expect(location.hash).toBe('#/home-copy')
  expect(input().closest('[data-saved]')!.getAttribute('data-saved')).toBe('home-copy')
  type('', 'Escape')
})
