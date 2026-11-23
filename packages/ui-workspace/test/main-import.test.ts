// A plain nano.json from before pages (neutral `slots`, no pages) opens: its legacy layout is migrated into the pages,
// its Main filling a Main that shows only tools (Review Focus 5) and keeping Main's title, icon and tool slots. And the wiring view's open-panel on an unbuilt Main
// adds a pod slot to Main's page instead of opening a panel.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('a legacy slots-only import fills a views-only Main with its pods; open-panel adds a slot through the Outline', async () => {
  const html = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  document.body.innerHTML = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('<script type="module">'))
  location.hash = '#/two'
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href, input = { implementation: 'nano.ui/input', eager: false }
  const pages = { roots: ['workspace', 'two'], pages: { workspace: { title: 'Main', slots: { x: { kind: 'tool', tool: 'systems' } } }, two: { title: 'Two', slots: {} } } }
  localStorage.setItem('nano-workspace.document', JSON.stringify({ pods: { spare: input }, runtimes: { main: { pods: ['spare'], subscriptions: [] } }, modules: { 'nano.ui': at }, views: {} }))
  localStorage.setItem('nano-workspace.outline', JSON.stringify(pages))
  const legacy = { pods: { a: input, b: input }, runtimes: { main: { pods: ['a', 'b'], subscriptions: [] } }, modules: { 'nano.ui': at }, views: {},
    layout: { slots: [{ id: 'a', runtime: 'main', pod: 'a' }, { id: 'b', runtime: 'main', pod: 'b' }], geometry: {} } }
  // happy-dom fetches no blob: URL (a browser does); the example is served
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : u.endsWith('examples/legacy/nano.json') ? new Response(JSON.stringify(legacy)) : (domFetch as Function)(u, ...rest)) as never
  const errors: unknown[] = []
  addEventListener('error', e => errors.push((e as ErrorEvent).error)); addEventListener('unhandledrejection', e => errors.push((e as PromiseRejectionEvent).reason))
  await import('../src/main.ts')
  const { outline, host } = await import('../src/boot-host.ts')
  const now = () => JSON.parse(JSON.stringify(outline!.document().doc))
  expect(document.querySelector('workspace-dock#workspace > .dock-area')).toBeNull()   // Main not built
  document.dispatchEvent(new CustomEvent('file:example', { detail: { name: 'legacy' } }))
  for (let i = 0; i < 200 && !outline!.document().doc.pages['workspace']!.slots['b']; i++) await tick(5)
  expect(host!.data().layout).toBeUndefined()   // the legacy layout is not kept
  expect(now().pages.workspace).toEqual({ slots: { x: { kind: 'tool', tool: 'systems' }, a: { kind: 'pod', pod: 'nano.ui/input@main/a' }, b: { kind: 'pod', pod: 'nano.ui/input@main/b' } }, title: 'Main' })   // a plain file's Main keeps Main's title and tool slots
  expect(Object.keys(now().pages)).toEqual(['workspace', 'two'])   // no "Workspace" page beside it
  // the wiring view's open-panel, Main unbuilt: a slot on Main's page (once), no panel opened
  document.dispatchEvent(new CustomEvent('wires:open-panel', { detail: { kind: 'pod', name: 'spare' } }))
  document.dispatchEvent(new CustomEvent('wires:open-panel', { detail: { kind: 'pod', name: 'spare' } }))
  expect(Object.keys(now().pages.workspace.slots)).toEqual(['x', 'a', 'b', 'spare'])
  expect(now().pages.workspace.slots.spare).toEqual({ kind: 'pod', pod: 'nano.ui/input@main/spare' })
  expect(document.querySelector('workspace-dock#workspace > .dock-area')).toBeNull()
  expect(errors).toEqual([])
})
