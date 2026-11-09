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
    <app-route path="/workspace"><div class="ws-page"><component-drawer for="workspace"></component-drawer><c-wires><workspace-dock id="workspace" storage-key="k"><template data-widget="notes" data-title="Notes"><p>n</p></template></workspace-dock></c-wires></div></app-route>
    <app-route path="*"></app-route></app-shell>`
  mountWorkspace(document, { path: '/foo', title: 'My Workspace', icon: 'rocket', system: 'lab' })
  mountWorkspace(document, { path: '/bar', title: 'Other', icon: 'star' })
  const nav = [...document.querySelectorAll('app-shell > [slot="nav"]')].map(a => a.textContent!.trim())
  expect(nav).toEqual(['Workspaces+', 'Main', 'My Workspace', 'Other', 'Inbox'])
  expect(document.querySelector('a[href="#/foo"]')!.hasAttribute('data-sub')).toBe(true)
  expect(document.querySelector('a[href="#/foo"] svg')).not.toBeNull()
  const route = document.querySelector('app-route[path="/foo"]')!
  expect(route.nextElementSibling!.getAttribute('path')).toBe('/bar')
  const dock = route.querySelector('.ws-page > c-wires > workspace-dock')!
  expect(route.querySelector('.ws-page > component-drawer')!.getAttribute('for')).toBe(dock.id)
  expect(dock.getAttribute('storage-key')).toBe('k.saved./foo')
  expect(dock.getAttribute('system')).toBe('lab')
  expect(document.querySelector('app-route[path="/bar"] workspace-dock')!.getAttribute('system')).toBe('host')
  expect(dock.querySelector('template[data-widget="notes"]')).not.toBeNull()
})

test('a mounted workspace runs in its system: its wiring view over that runtime (platform calls in host), its dock on that registry', async () => {
  const { Components, Ops, Registries, Runtimes } = await import('@pritzlaff/nano-core')
  const { platform, PlatformOps: P, runtimeOf } = await import('@composable/platform')
  const host = Runtimes.create(Registries.create('host'))
  host.registry.add('platform', Components.instantiate(platform(host, {})))
  await host.call({ registry: 'host', instance: 't' }, 'platform', Ops.key(P.createSystem), 'lab')
  document.body.innerHTML = `<app-shell><div slot="nav" data-workspaces></div>
    <app-route path="/workspace"><div class="ws-page"><c-wires><workspace-dock id="workspace" storage-key="k"></workspace-dock></c-wires></div></app-route></app-shell>`
  Object.assign(document.querySelector('c-wires')!, { runtime: host })
  mountWorkspace(document, { path: '/lab', title: 'Lab', icon: 'box', system: 'lab' })
  const route = document.querySelector('app-route[path="/lab"]')!
  const wires = route.querySelector('c-wires') as HTMLElement & { runtime?: unknown; host?: unknown }
  expect(wires.runtime).toBe(runtimeOf(host.registry, 'lab'))
  expect(wires.host).toBe(host)
  expect((route.querySelector('workspace-dock') as HTMLElement & { registry?: unknown }).registry).toBe(runtimeOf(host.registry, 'lab')!.registry)
})

test('+ makes a workspace in a new system, empty; a taken route is refused with the input kept', async () => {
  const { Components, Ops, Registries, Runtimes } = await import('@pritzlaff/nano-core')
  const { platform, PlatformOps: P, runtimeOf } = await import('@composable/platform')
  const { bootSavedWorkspaces } = await import('../src/components/saved-workspaces.ts')
  localStorage.clear()
  const host = Runtimes.create(Registries.create('host'))
  host.registry.add('platform', Components.instantiate(platform(host, {})))
  document.body.innerHTML = `<app-shell><div slot="nav" class="nav-row" data-workspaces><a href="#/workspace">Workspaces</a><button data-new-workspace>+</button></div>
    <a slot="nav" data-sub href="#/workspace">Main</a>
    <app-route path="/workspace"><div class="ws-page"><c-wires><workspace-dock id="workspace" storage-key="k"></workspace-dock></c-wires></div></app-route><app-route path="*"></app-route></app-shell>`
  Object.assign(document.querySelector('c-wires')!, { runtime: host })
  bootSavedWorkspaces(document)
  const tick = () => new Promise(r => setTimeout(r, 0))
  const dialog = () => document.querySelector('dialog[aria-label="New workspace"]') as HTMLDialogElement
  const field = (name: string) => dialog().querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement
  const type = (name: string, v: string) => { const f = field(name); f.value = v; f.dispatchEvent(new Event('input')); f.dispatchEvent(new Event('change')) }

  ;(document.querySelector('[data-new-workspace]') as HTMLButtonElement).click(); await tick()
  expect([...(field('system') as HTMLSelectElement).options].map(o => o.value)).toEqual(['host', 'new'])
  type('title', 'Lab Bench')
  expect(field('path').value).toBe('/lab-bench')   // filled from the name
  type('system', 'new'); type('newSystem', 'lab')
  dialog().close('save'); await tick(); await tick()
  expect(runtimeOf(host.registry, 'lab')).toBeDefined()
  expect(document.querySelector('a[href="#/lab-bench"]')!.textContent).toBe('Lab Bench')
  const dock = document.querySelector('app-route[path="/lab-bench"] workspace-dock')!
  expect(dock.getAttribute('system')).toBe('lab')
  expect(dock.getAttribute('open')).toBe('')   // starts empty

  ;(document.querySelector('[data-new-workspace]') as HTMLButtonElement).click(); await tick()
  type('title', 'Again'); type('path', '/lab-bench'); type('system', 'lab')
  dialog().close('save'); await tick(); await tick()
  expect(dialog().textContent).toContain('already')
  expect(field('title').value).toBe('Again')
  expect(field('system').value).toBe('lab')
  dialog().close('cancel'); await tick()
  expect(dialog()).toBeNull()
})
