// Tool slots (ADR-0041): a stored document with view slots (the widget ids of before) loads as tool slots, read through
// the workspace's table, and Main's dock shows the same widgets; nothing written after holds a `view`.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('stored view slots load as tool slots and show the same widgets; nothing writes view', async () => {
  const html = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  document.body.innerHTML = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('<script type="module">'))
  location.hash = '#/p/workspace'
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  const stored = { roots: ['workspace'], pages: { workspace: { title: 'Main', slots: { x: { kind: 'view', view: 'nano-explorer' }, n: { kind: 'view', view: 'notes' }, w: { kind: 'view', view: 'nano-wiring' } } } } }
  localStorage.setItem('nano-workspace.document', JSON.stringify({ pods: {}, runtimes: {}, modules: { 'nano.ui': at }, views: {} }))
  localStorage.setItem('nano-workspace.outline', JSON.stringify(stored))
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : (domFetch as Function)(u, ...rest)) as never
  HTMLAnchorElement.prototype.click = function () {}   // a download
  await import('../src/main.ts')
  const { outline } = await import('../src/boot-host.ts')
  const slots = { x: { kind: 'tool', tool: 'systems' }, n: { kind: 'tool', tool: 'notes' }, w: { kind: 'tool', tool: 'wiring' } }
  expect(JSON.parse(JSON.stringify(outline!.document().doc.pages['workspace']!.slots))).toEqual(slots)
  const dock = document.querySelector('workspace-dock#workspace')!, shown = () => ['nano-explorer', 'notes-panel', 'nano-wiring'].every(t => dock.querySelector(`.dock-panel ${t}`))
  for (let i = 0; i < 200 && !shown(); i++) await tick(5)
  expect(shown()).toBe(true)
  await tick(50)
  expect(JSON.parse(JSON.stringify(outline!.document().doc.pages['workspace']!.slots))).toEqual(slots)   // the dock's rewrite keeps them
  for (let i = 0; i < 50 && !localStorage.getItem('nano-host.document')?.includes('"tool"'); i++) await tick(20)
  const before = blobs.size
  document.dispatchEvent(new CustomEvent('file:save'))
  for (const written of [localStorage.getItem('nano-host.document')!, await [...blobs.values()][before]!.text()]) {
    expect(written).toMatch(/"kind":\s*"tool"/)
    expect(written).not.toMatch(/"view"/)
  }
})
