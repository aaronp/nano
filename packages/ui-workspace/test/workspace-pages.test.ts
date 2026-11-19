// Workspace pages: mounting a saved one, and Duplicate, Edit and a refused choice through a stubbed dialog.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import { bootWorkspacePages, mountWorkspace } from '../src/components/workspace-pages.ts'
import type { WorkspaceChoice } from '../src/components/workspace-dialog.ts'

const tick = () => new Promise(r => setTimeout(r, 0))
localStorage.clear()
document.body.innerHTML = `<nav><div slot="nav" class="nav-row" data-workspaces><a href="#/workspace">Workspaces</a><button data-toggle-drawer></button><button data-new-workspace>+</button></div></nav>
  <main><app-route path="/workspace"><div class="ws-page"><component-drawer for="workspace"></component-drawer><c-wires>
    <workspace-dock id="workspace" storage-key="main"><template data-widget="a"></template><template data-widget="b"></template></workspace-dock>
  </c-wires></div></app-route><app-route path="*"></app-route></main>`
const template = { template: 'one', order: [{ widget: 'a' }], dock: { root: null } }
Object.assign(document.querySelector('#workspace')!, { arrangement: () => ({ root: { type: 'row' }, template }) })

const answers: (WorkspaceChoice | null)[] = [], asked: { heading: string; error?: string; prev?: WorkspaceChoice }[] = []
bootWorkspacePages(document, async (_doc, opts) => { asked.push(opts); return answers.shift() ?? null })
const routes = () => [...document.querySelectorAll('app-route')].map(r => r.getAttribute('path'))

test('mountWorkspace adds a nav row and a route before the not-found page, with a dock of Main\'s widgets', () => {
  mountWorkspace(document, { path: '/lab', title: 'Lab', icon: 'star' })
  const row = document.querySelector<HTMLElement>('[data-saved="/lab"]')!
  expect(row.previousElementSibling?.hasAttribute('data-workspaces')).toBe(true)
  expect(row.querySelector('a')!.getAttribute('href')).toBe('#/lab')
  expect(row.querySelector('[data-edit]')!.getAttribute('aria-label')).toBe('Edit Lab')
  expect(routes()).toEqual(['/workspace', '/lab', '*'])
  expect(document.querySelector<HTMLElement>('app-route[path="/lab"]')!.hidden).toBe(true)
  const dock = document.querySelector('app-route[path="/lab"] workspace-dock')!
  expect(dock.id).toBe('ws_lab')
  expect(dock.getAttribute('storage-key')).toBe('main.saved./lab')
  expect([...dock.querySelectorAll('template')].map(t => t.dataset.widget)).toEqual(['a', 'b'])
})

test('Duplicate on Main copies its arrangement and template into a new page, lists it and goes there', async () => {
  answers.push({ path: '/b', title: 'B', icon: 'star' })
  document.querySelector<HTMLButtonElement>('[data-workspaces] [data-duplicate]')!.click(); await tick()
  expect(JSON.parse(localStorage.getItem('main.saved./b')!)).toEqual({ root: { type: 'row' } })
  expect(JSON.parse(localStorage.getItem('main.saved./b.template')!)).toEqual(template)
  expect(JSON.parse(localStorage.getItem('workspace-starter.saved-workspaces')!)).toEqual([{ path: '/b', title: 'B', icon: 'star' }])
  expect(location.hash).toBe('#/b')
  expect(routes()).toContain('/b')
})

test('Edit to a new route moves the keys and updates the link and route', async () => {
  answers.push({ path: '/c', title: 'C', icon: 'box' })
  document.querySelector('app-route[path="/b"] component-drawer')!.innerHTML = '<a data-dock-add="ws_b" data-widget="a">A</a>'
  document.querySelector<HTMLButtonElement>('[data-saved="/b"] [data-edit]')!.click(); await tick()
  expect(asked.at(-1)!.prev).toEqual({ path: '/b', title: 'B', icon: 'star' })
  expect(localStorage.getItem('main.saved./b')).toBeNull()
  expect(localStorage.getItem('main.saved./c')).not.toBeNull()
  expect(localStorage.getItem('main.saved./c.template')).not.toBeNull()
  const row = document.querySelector('[data-saved="/c"]')!
  expect(row.querySelector('a')!.getAttribute('href')).toBe('#/c')
  expect(routes()).toContain('/c'); expect(routes()).not.toContain('/b')
  const dock = document.querySelector('app-route[path="/c"] workspace-dock')!
  expect(dock.getAttribute('storage-key')).toBe('main.saved./c')
  expect(dock.id).toBe('ws_c')
  expect(document.querySelector('app-route[path="/c"] component-drawer')!.getAttribute('for')).toBe('ws_c')
  expect(document.querySelector('[data-dock-add]')!.getAttribute('data-dock-add')).toBe('ws_c')
  expect(location.hash).toBe('#/c')
})

test('a refused choice asks again with the reason; + makes an empty page', async () => {
  answers.push({ path: '/workspace', title: 'X', icon: 'star' }, { path: '/d', title: 'D', icon: 'star' })
  document.querySelector<HTMLButtonElement>('[data-new-workspace]')!.click(); await tick(); await tick()
  expect(asked.at(-1)!.error).toContain('already')
  expect(asked.at(-1)!.prev?.path).toBe('/workspace')
  expect(routes()).toContain('/d')
  expect(localStorage.getItem('main.saved./d')).toBeNull()
})
