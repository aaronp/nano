// Saved workspaces: a route, title and icon for a copy of the workspace, listed in the nav.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import { ICONS, savedWorkspaces } from '../src/lib/saved-workspaces.ts'
import { mountWorkspace } from '../src/components/saved-workspaces.ts'

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } } }

test('a saved workspace needs a free /path, a title and a known icon, and is remembered', () => {
  const store = memory(), saved = savedWorkspaces(store), taken = ['/', '/workspace']
  expect(Object.keys(ICONS)).toContain('rocket')
  expect(saved.add({ path: 'foo', title: 'My Workspace', icon: 'rocket' }, taken)).toContain('/')
  expect(saved.add({ path: '/workspace', title: 'Mine', icon: 'rocket' }, taken)).toContain('already')
  expect(saved.add({ path: '/foo', title: ' ', icon: 'rocket' }, taken)).toContain('title')
  expect(saved.add({ path: '/foo', title: 'Mine', icon: 'nope' }, taken)).toContain('icon')
  expect(saved.add({ path: '/foo', title: 'My Workspace', icon: 'rocket' }, taken)).toBeNull()
  expect(savedWorkspaces(store).list()).toEqual([{ path: '/foo', title: 'My Workspace', icon: 'rocket', system: 'host' }])
  expect(saved.add({ path: '/bar', title: 'Lab', icon: 'star', system: 'Bad Name' }, taken)).toContain('system')
  expect(saved.add({ path: '/bar', title: 'Lab', icon: 'star', system: 'lab' }, taken)).toBeNull()
  expect(savedWorkspaces(store).list()[1]!.system).toBe('lab')
  expect(saved.add({ path: '/foo', title: 'Again', icon: 'star' }, taken)).toContain('already')
})

test('mounting one adds a sub-item under Workspaces, and a page with a drawer beside a dock in its system', () => {
  document.body.innerHTML = `<app-shell>
    <div slot="nav" class="nav-row" data-workspaces><a href="#/workspace">Workspaces</a><button data-new-workspace>+</button></div>
    <a slot="nav" data-sub href="#/workspace">Main</a>
    <a slot="nav" href="#/inbox">Inbox</a>
    <app-route path="/workspace"><split-pane><component-drawer for="workspace"></component-drawer><c-wires><workspace-dock id="workspace" storage-key="k"><template data-widget="notes" data-title="Notes"><p>n</p></template></workspace-dock></c-wires></split-pane></app-route>
    <app-route path="*"></app-route></app-shell>`
  mountWorkspace(document, { path: '/foo', title: 'My Workspace', icon: 'rocket', system: 'lab' })
  mountWorkspace(document, { path: '/bar', title: 'Other', icon: 'star' })
  const nav = [...document.querySelectorAll('app-shell > [slot="nav"]')].map(a => a.textContent!.trim())
  expect(nav).toEqual(['Workspaces+', 'Main', 'My Workspace', 'Other', 'Inbox'])
  expect(document.querySelector('a[href="#/foo"]')!.hasAttribute('data-sub')).toBe(true)
  expect(document.querySelector('a[href="#/foo"] svg')).not.toBeNull()
  const route = document.querySelector('app-route[path="/foo"]')!
  expect(route.nextElementSibling!.getAttribute('path')).toBe('/bar')
  const dock = route.querySelector('split-pane > c-wires > workspace-dock')!
  expect(route.querySelector('split-pane > component-drawer')!.getAttribute('for')).toBe(dock.id)
  expect(dock.getAttribute('storage-key')).toBe('k.saved./foo')
  expect(dock.getAttribute('system')).toBe('lab')
  expect(document.querySelector('app-route[path="/bar"] workspace-dock')!.getAttribute('system')).toBe('host')
  expect(dock.querySelector('template[data-widget="notes"]')).not.toBeNull()
})
