// The File menu with Main's dock never built (a deep link to another page): Save writes the file from Main's page
// (the store's), and New empties Main's page without touching its dock.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('a deep link to another page: Save writes the file from the pages, New does not throw', async () => {
  const html = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  document.body.innerHTML = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('<script type="module">'))
  location.hash = '#/two'
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href, layout = { root: { type: 'row', content: [] }, 'window-style': 'focus' }
  const pages = [{ id: 'workspace', title: 'Main', slots: [{ id: 'notes', view: 'notes' }], workspace: layout }, { id: 'two', title: 'Two', slots: [] }]
  localStorage.setItem('nano-workspace.document', JSON.stringify({ pods: {}, runtimes: {}, modules: { 'nano.ui': at }, views: {}, layout: { pages } }))
  // happy-dom fetches no blob: URL (a browser does); the downloads are kept
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : (domFetch as Function)(u, ...rest)) as never
  HTMLAnchorElement.prototype.click = function () {}   // a download (happy-dom would navigate to it)
  const errors: unknown[] = []
  addEventListener('error', e => errors.push((e as ErrorEvent).error)); addEventListener('unhandledrejection', e => errors.push((e as PromiseRejectionEvent).reason))
  await import('../src/main.ts')
  const { pages: store } = await import('../src/boot-host.ts')
  expect(document.querySelector('workspace-dock#workspace > .dock-area')).toBeNull()   // Main not built
  const before = blobs.size
  document.dispatchEvent(new CustomEvent('file:save'))
  const file = JSON.parse(await [...blobs.values()][before]!.text())
  expect(file.layout.workspace).toEqual({ root: { type: 'row', content: [] } })
  expect(file.layout.pages.map((p: { id: string }) => p.id)).toEqual(['workspace', 'two'])
  document.dispatchEvent(new CustomEvent('file:new'))
  await tick(50)
  expect(store.get('workspace')).toEqual({ id: 'workspace', title: 'Main', slots: [] })
  expect(errors).toEqual([])
  expect(document.querySelector('workspace-dock#workspace > .dock-area')).toBeNull()
})
