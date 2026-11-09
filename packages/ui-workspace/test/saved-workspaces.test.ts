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
  expect(savedWorkspaces(store).list()).toEqual([{ path: '/foo', title: 'My Workspace', icon: 'rocket' }])
  expect(saved.add({ path: '/foo', title: 'Again', icon: 'star' }, taken)).toContain('already')
})

test('mounting one adds its nav item after the workspace group, and a page with a dock of the same widgets', () => {
  document.body.innerHTML = `<app-shell>
    <a slot="nav" href="#/workspace">Workspace</a><a slot="nav" data-sub href="#/workspace">+ Notes</a>
    <a slot="nav" href="#/inbox">Inbox</a>
    <app-route path="/workspace"><c-wires><workspace-dock id="workspace" storage-key="k"><template data-widget="notes" data-title="Notes"><p>n</p></template></workspace-dock></c-wires></app-route>
    <app-route path="*"></app-route></app-shell>`
  mountWorkspace(document, { path: '/foo', title: 'My Workspace', icon: 'rocket' })
  const nav = [...document.querySelectorAll('a[slot="nav"]')].map(a => a.textContent)
  expect(nav).toEqual(['Workspace', '+ Notes', 'My Workspace', 'Inbox'])
  expect(document.querySelector('a[href="#/foo"] svg')).not.toBeNull()
  const route = document.querySelector('app-route[path="/foo"]')!
  expect(route.nextElementSibling!.getAttribute('path')).toBe('*')
  const dock = route.querySelector('c-wires > workspace-dock')!
  expect(dock.getAttribute('storage-key')).toBe('k.saved./foo')
  expect(dock.querySelector('template[data-widget="notes"]')).not.toBeNull()
})
