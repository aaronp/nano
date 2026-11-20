// main.ts's import of a legacy file (neutral `slots`, no pages) with Main's dock never built (a deep link to another
// page): its pods take the place of Main's pod slots; Main's view slots and engine state stay. And the wiring view's
// open-panel on an unbuilt Main adds a slot to Main's page instead of opening a panel.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('a legacy slots-only import on a never-built Main replaces its pod slots only; open-panel adds a slot through the store', async () => {
  const html = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  document.body.innerHTML = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('<script type="module">'))
  location.hash = '#/two'
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href, input = { implementation: 'nano.ui/input', eager: false }
  const engine = { root: { type: 'row', content: [] }, saved: { root: null }, 'window-style': 'clear' }
  const main = { id: 'workspace', title: 'Main', slots: [{ id: 'x', view: 'nano-explorer' }, { id: 'old', runtime: 'main', pod: 'old' }], workspace: engine }
  localStorage.setItem('nano-workspace.document', JSON.stringify({ pods: { old: input, spare: input }, runtimes: { main: { pods: ['old', 'spare'], subscriptions: [] } }, modules: { 'nano.ui': at }, views: {},
    layout: { pages: [main, { id: 'two', title: 'Two', slots: [] }] } }))
  const legacy = { pods: { a: input, b: input }, runtimes: { main: { pods: ['a', 'b'], subscriptions: [] } }, modules: { 'nano.ui': at }, views: {},
    layout: { slots: [{ id: 'a', runtime: 'main', pod: 'a' }, { id: 'b', runtime: 'main', pod: 'b' }] } }
  // happy-dom fetches no blob: URL (a browser does); the example is served
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : u.endsWith('examples/legacy/nano.json') ? new Response(JSON.stringify(legacy)) : (domFetch as Function)(u, ...rest)) as never
  const errors: unknown[] = []
  addEventListener('error', e => errors.push((e as ErrorEvent).error)); addEventListener('unhandledrejection', e => errors.push((e as PromiseRejectionEvent).reason))
  await import('../src/main.ts')
  const { pages: store, host } = await import('../src/boot-host.ts')
  expect(document.querySelector('workspace-dock#workspace > .dock-area')).toBeNull()   // Main not built
  document.dispatchEvent(new CustomEvent('file:example', { detail: { name: 'legacy' } }))
  for (let i = 0; i < 200 && !host!.data().pods['b']; i++) await tick(5)
  await tick(20)
  expect(store.get('workspace')).toEqual({ ...main, slots: [{ id: 'x', view: 'nano-explorer' }, { id: 'a', runtime: 'main', pod: 'a' }, { id: 'b', runtime: 'main', pod: 'b' }] })
  expect(store.list().map(p => p.id)).toEqual(['workspace', 'two'])   // no "Workspace" page beside it
  // the wiring view's open-panel, Main unbuilt: a slot on Main's page (once), no panel opened
  document.dispatchEvent(new CustomEvent('wires:open-panel', { detail: { kind: 'pod', name: 'spare' } }))
  document.dispatchEvent(new CustomEvent('wires:open-panel', { detail: { kind: 'pod', name: 'spare' } }))
  expect(store.get('workspace')!.slots.map(s => s.id)).toEqual(['x', 'a', 'b', 'spare'])
  expect(document.querySelector('workspace-dock#workspace > .dock-area')).toBeNull()
  expect(errors).toEqual([])
})
