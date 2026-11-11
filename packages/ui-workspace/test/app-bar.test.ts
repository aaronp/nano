// <nano-app-bar>: the app bar shows the instance the app gateway's appBar names; boot-app-bar drives the gateway from
// page changes (each workspace's controls as the default) and panel focus (dock:focus).
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, mock, test } from 'bun:test'

// bun runs golden-layout's CommonJS build, which needs tslib (not installed); the browser bundle uses its ES build
const esm = Bun.resolveSync('golden-layout/dist/esm/index.js', import.meta.dir)
mock.module('golden-layout', () => import(esm))
mock.module('golden-layout/dist/css/goldenlayout-base.css', () => ({ default: '' }))

// lit picks its DOM build when first imported, so these come after the DOM exists
const { Components, Ops } = await import('@pritzlaff/nano-core')
const { AppGateway } = await import('@composable/shell')
const { PlatformOps: P, runtimeOf } = await import('@composable/platform')
await import('../src/boot-theme.ts')
const page = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
document.body.innerHTML = page.slice(page.indexOf('<body>') + 6, page.indexOf('</body>'))
location.hash = '#/workspace'
const { host, catalog } = await import('../src/composable.ts')
const { mountWorkspace } = await import('../src/components/saved-workspaces.ts')
await import('../src/components/app-shell.ts')
await import('../src/components/workspace-dock.ts')
await import('../src/boot-app-bar.ts')

const tick = () => new Promise(r => setTimeout(r, 0))
const until = async (ok: () => boolean) => { for (let i = 0; i < 50 && !ok(); i++) await tick(); return ok() }
const go = async (hash: string) => { location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); await tick() }
const bar = () => document.querySelector('nano-app-bar')!
const shown = () => [...bar().children].map(c => `${c.localName}[${c.getAttribute('name')}]`)
const controls = (dock: string) => `nano-workspace-controls[ws-controls-${dock}]`
const me = { registry: 'host', instance: 'test' }
const focus = (detail: unknown) => document.dispatchEvent(new CustomEvent('dock:focus', { detail }))

/** A component that puts itself in the app bar when the focus names it (in its own system), with an element. */
const BarSpy = Components.create({ ns: 't', name: 'bar-spy' }, () => ({}))
BarSpy.action(Ops.sink('t', 'focus', AppGateway.ops.focus.output!), (_, arg, env) => {
  const f = arg as { system: string; instance: string } | null, own = env.handles()[0]!
  if (f && f.system === own.coord.registry && f.instance === own.coord.instance) void own.call('app', AppGateway.ops.setAppBarComponent, { system: f.system, instance: f.instance })
})
customElements.define('x-bar-spy', class extends HTMLElement { get model() { return this.getAttribute('name') } })
;(catalog as Record<string, unknown>)['bar-spy'] = { component: BarSpy, title: 'Bar spy', tag: 'x-bar-spy', modes: ['host'], trust: 'trusted' }
const addSpy = (reg: typeof host.registry, id: string) => {
  reg.add(id, Components.instantiate(BarSpy))
  reg.subscribe({ source: 'app', op: Ops.key(AppGateway.ops.focus), listener: id, target: 't/focus' })
}

test('on the workspace page the app bar shows its controls', async () => {
  await go('#/workspace')
  expect(await until(() => shown().join() === controls('workspace'))).toBe(true)
  const el = bar().firstElementChild as HTMLElement & { registry?: unknown }
  expect(el.registry).toBe(host.registry)
})

test('a saved workspace page shows its own dock\'s controls', async () => {
  await host.call(me, 'platform', Ops.key(P.createSystem), 'lab')
  mountWorkspace(document, { path: '/lab', title: 'Lab', icon: 'box', system: 'lab' })
  await go('#/lab')
  expect(await until(() => shown().join() === controls('ws-lab'))).toBe(true)
})

test('a page without a dock empties the bar', async () => {
  await go('#/settings')
  expect(await until(() => bar().children.length === 0)).toBe(true)
})

test('a focused panel puts up its own controls, and they leave with focus', async () => {
  await go('#/workspace')
  addSpy(host.registry, 'spy-1')
  expect(await until(() => shown().join() === controls('workspace'))).toBe(true)
  focus({ system: 'host', instance: 'spy-1', widget: 'workspace' })
  expect(await until(() => shown().join() === 'x-bar-spy[spy-1]')).toBe(true)
  focus(null)
  expect(await until(() => shown().join() === controls('workspace'))).toBe(true)
})

test('the same component in a workspace system reaches the gateway', async () => {
  await go('#/lab')
  const lab = runtimeOf(host.registry, 'lab')!.registry
  addSpy(lab, 'spy-2')
  focus({ system: 'lab', instance: 'spy-2', widget: 'ws-lab' })
  expect(await until(() => shown().join() === 'x-bar-spy[spy-2]')).toBe(true)
  expect((bar().firstElementChild as HTMLElement & { registry?: unknown }).registry).toBe(lab)
  focus(null)
  expect(await until(() => shown().join() === controls('ws-lab'))).toBe(true)
})

test('an unresolvable target shows nothing and says so', async () => {
  await host.call(me, 'app', Ops.key(AppGateway.ops.setAppBarComponent), { system: 'host', instance: 'nope' })
  expect(await until(() => bar().children.length === 0)).toBe(true)
  expect(await until(() => document.querySelector('[data-nano-status]')?.textContent?.includes('nope has no element to show in the app bar') ?? false)).toBe(true)
})

test('after a page change, clicking the panel that had focus puts its controls up again', async () => {
  await go('#/workspace')
  const dock = document.querySelector('workspace-dock#workspace') as HTMLElement & { addTemplate(t: HTMLTemplateElement): void; addWidget(id: string, name?: string): void }
  const t = Object.assign(document.createElement('template'), { innerHTML: '<x-bar-spy keep></x-bar-spy>' })
  t.dataset.widget = 'bar-spy'; t.dataset.title = 'Bar spy'
  dock.addTemplate(t); dock.addWidget('bar-spy', 'spy-1'); await tick()
  const click = () => dock.querySelector('x-bar-spy[name="spy-1"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  click()
  expect(await until(() => shown().join() === 'x-bar-spy[spy-1]')).toBe(true)
  await go('#/settings')
  expect(await until(() => bar().children.length === 0)).toBe(true)
  await go('#/workspace')
  expect(await until(() => shown().join() === controls('workspace'))).toBe(true)
  click()
  expect(await until(() => shown().join() === 'x-bar-spy[spy-1]')).toBe(true)
})
