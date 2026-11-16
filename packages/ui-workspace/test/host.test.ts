// The host on @pritzlaff/nano-core: the built-ins, importing the slice (explorer, Save round-trip), a failed import, HostUI.approve.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
// The page is served from the repo, as file: (bun can import file: modules, not http:), so the host and the slice agree on bundle/nano-ui.js.
const page = new URL('../../../', import.meta.url).href
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: page })
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { plugin } from 'bun'
import { Type } from 'typebox'
import { Schema, Interface, Implementation, Op, Pod, provide, Provider, type AppDeployment } from '@pritzlaff/nano-core'
import type { Host } from '../src/host.ts'
// After happy-dom is registered (static imports would run first): elements define themselves on import.
await import('../src/boot-theme.ts')   // as main.ts does first
const { Any, defineViews, HostUI } = await import('@pritzlaff/nano-ui')
const { start } = await import('../src/host.ts')
await import('../src/shell.ts')

// What the served site maps: /bundle/nano-ui.js is packages/ui, the slice's ./shout.js its shout.ts (one module each).
const at = (rel: string) => new URL(rel, import.meta.url).pathname
const served: Record<string, string> = { 'nano-ui': at('../../ui/src/index.ts'), shout: at('../../../examples/slice/shout.ts') }
plugin({ name: 'served', setup(b) {
  b.onResolve({ filter: /(bundle\/nano-ui|examples\/slice\/shout)\.js$/ }, a => ({ path: a.path.includes('shout') ? 'shout' : 'nano-ui', namespace: 'served' }))
  b.onLoad({ filter: /.*/, namespace: 'served' }, a => ({ contents: `export * from '${served[a.path]}'; export { default } from '${served[a.path]}'`, loader: 'ts' }))
} })

await import('../src/dock/dock.ts')

// happy-dom's fetch refuses file: URLs: read them with Bun.file, or from `json`.
const json = new Map<string, unknown>()
const domFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = (async (u: string) => {
    if (json.has(u)) return { ok: true, status: 200, json: async () => structuredClone(json.get(u)) }
    const f = Bun.file(new URL(u)), ok = await f.exists()
    return { ok, status: ok ? 200 : 404, json: () => f.json() }
  }) as never
})
afterAll(() => { globalThis.fetch = domFetch })

defineViews()
const slice = new URL('../../../examples/slice/nano.json', import.meta.url).href
type Shell = HTMLElement & { host: Host; updateComplete: Promise<unknown> }
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
async function mount() {
  const r = await start()
  if (!r.ok) throw new Error(r.fail.reason)
  const el = document.createElement('workspace-shell') as Shell
  el.host = r.value
  const dock = el.appendChild(document.createElement('workspace-dock')) as HTMLElement & { host: Host }
  document.body.replaceChildren(el)
  dock.host = r.value
  await el.updateComplete
  return { host: r.value, el }
}

test('given a fresh host, then the built-ins input, debounce, map and log are listed and main holds only ui', async () => {
  const { host, el } = await mount()
  const builtins = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('[data-builtin]')]
  expect(builtins.map(b => b.textContent!.trim())).toEqual(['input', 'debounce', 'map', 'log'])
  expect(host.app.deployment().runtimes).toEqual({ main: { pods: ['ui'], subscriptions: [] } })
  builtins[2]!.click()
  await tick(10)
  expect(host.app.deployment().runtimes.main!.pods).toEqual(['ui', 'map1'])
})

test('given the slice imported, then the explorer lists in, wait, up, out and Save round-trips providers and views', async () => {
  const { host, el } = await mount()
  expect(await host.importUrl(slice)).toMatchObject({ ok: true })
  await el.updateComplete
  const tree = el.querySelector('workspace-dock nano-explorer')!.shadowRoot!.querySelector('nano-tree') as HTMLElement & { updateComplete: Promise<unknown> }
  await tree.updateComplete
  for (const pod of ['in', 'wait', 'up', 'out']) expect(tree.shadowRoot!.textContent).toContain(pod)

  const layout = { dock: { root: { type: 'component', componentType: 'panel', componentState: { id: 'pod:up' } } } }
  expect(await host.apply({ ...host.data(), views: { up: 'nano-pod-view' }, layout })).toMatchObject({ ok: true })
  const saved = host.saved()
  expect(saved.layout).toEqual(layout)   // kept by the host, so it round-trips below
  const file: AppDeployment = await Bun.file(new URL(slice)).json()
  // stored resolved, so a saved nano.json loads from anywhere on the origin
  expect(saved.providers).toEqual({ 'nano.ui': new URL('./bundle/nano-ui.js', page).href, 'example.slice': new URL('./shout.js', slice).href })
  expect(saved.views).toEqual({ up: 'nano-pod-view' })
  expect(saved.pods).toEqual(file.pods)
  expect(saved.runtimes).toEqual(file.runtimes)

  const again = new URL('./saves/nano.json', import.meta.url).href   // another directory than the slice's
  json.set(again, saved)
  const fresh = (await mount()).host
  expect(await fresh.importUrl(again)).toMatchObject({ ok: true })
  expect(fresh.saved()).toEqual(saved)
})

test('given an app with a pod named ui, then the import is refused and the registry and deployment are unchanged', async () => {
  const { host } = await mount()
  const before = { manifest: host.registry.manifest(), data: host.data() }
  const clash = new URL('./clash/nano.json', import.meta.url).href
  json.set(clash, { pods: { ui: { implementation: 'example.slice/shout', eager: false } }, runtimes: {}, providers: { 'example.slice': new URL('./shout.js', slice).href } })
  expect(await host.importUrl(clash)).toMatchObject({ ok: false, fail: { reason: 'clash: pod ui is already loaded' } })
  expect(host.registry.manifest()).toEqual(before.manifest)
  expect(host.data()).toEqual(before.data)
})

test('given an import whose provider 404s, then a toast names it and the deployment is unchanged', async () => {
  const { host } = await mount()
  const before = host.data()
  const r = await host.importUrl(new URL('./fixtures/missing.json', import.meta.url).href)
  expect(r.ok).toBe(false)
  const toaster = document.querySelector('nano-toaster') as HTMLElement & { toasts: { title: string }[] }
  expect(toaster.toasts.map(t => t.title).join()).toContain('missing.js')
  expect(host.data()).toEqual(before)
})

test('given HostUI.approve called from a pod, then a dialog opens and choosing Approve resolves true', async () => {
  const { host } = await mount()
  const Ask = Interface.define('test.Ask', { ask: Op.action('ask', Schema.define('None', Type.Null()), Any) })
  const asker = Implementation.define('test.ask/asker', {
    provides: [Ask], dependencies: { ui: HostUI },
    make: ctx => [provide(Ask, { ask: async () => ctx.one(HostUI).call.approve({ title: 'Send it?' }) })],
  })
  expect(host.registry.add(Provider.define('test.ask', [asker]))).toMatchObject({ ok: true })
  const d = host.data()
  expect(await host.apply({ ...d, pods: { ...d.pods, asker: Pod.lazy(asker) },
    runtimes: { main: { pods: ['ui', 'asker'], subscriptions: [{ kind: 'call', from: 'asker', to: 'ui' }] } } })).toMatchObject({ ok: true })

  const answer = host.app.call('main', 'asker').ask(null)
  for (let i = 0; i < 50 && !document.querySelector('dialog'); i++) await tick(5)
  const dialog = document.querySelector('dialog')!
  expect(dialog.textContent).toContain('Send it?')
  expect([...dialog.querySelectorAll('button')].filter(b => b.autofocus).map(b => b.textContent)).toEqual(['Deny'])
  ;[...dialog.querySelectorAll('button')].find(b => b.textContent === 'Approve')!.click()
  expect(await answer).toEqual({ ok: true, value: true })
  expect(document.querySelector('dialog')).toBeNull()
})
