// The File menu with Main's dock never built (a deep link to another page): Save writes `{ app, platform }` (the app's
// nano.json and the Platform's pages), and New empties Main's page (its title kept) without touching its dock.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('a deep link to another page: Save writes the bundle, New empties Main and does not throw', async () => {
  const html = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  document.body.innerHTML = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('<script type="module">'))
  location.hash = '#/two'
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href, layout = { root: { type: 'row', content: [] }, 'window-style': 'focus' }
  const pages = { pages: { workspace: { title: 'Main', slots: { notes: { kind: 'view', view: 'notes' } }, layout: { workspace: layout }, meta: { workspace: { order: 0 } } }, two: { title: 'Two', slots: {}, meta: { workspace: { order: 1 } } } } }
  const app = { pods: {}, runtimes: {}, modules: { 'nano.ui': at }, views: {} }
  localStorage.setItem('nano-workspace.document', JSON.stringify(app)); localStorage.setItem('nano-workspace.platform', JSON.stringify(pages))
  // happy-dom fetches no blob: URL (a browser does); the downloads are kept
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : (domFetch as Function)(u, ...rest)) as never
  HTMLAnchorElement.prototype.click = function () {}   // a download (happy-dom would navigate to it)
  const errors: unknown[] = []
  addEventListener('error', e => errors.push((e as ErrorEvent).error)); addEventListener('unhandledrejection', e => errors.push((e as PromiseRejectionEvent).reason))
  await import('../src/main.ts')
  const { platform } = await import('../src/boot-host.ts')
  expect(document.querySelector('workspace-dock#workspace > .dock-area')).toBeNull()   // Main not built
  const before = blobs.size
  document.dispatchEvent(new CustomEvent('file:save'))
  const file = JSON.parse(await [...blobs.values()][before]!.text())
  expect(file.app).toMatchObject(app)
  expect(file.platform).toEqual(JSON.parse(JSON.stringify(platform!.document().doc)))   // the Platform's pages (the shown dock's arrangement written in)
  expect(file.platform.pages.workspace).toEqual(pages.pages.workspace)
  document.dispatchEvent(new CustomEvent('file:new'))
  await tick(50)
  expect(JSON.parse(JSON.stringify(platform!.document().doc.pages['workspace']))).toEqual({ title: 'Main', slots: {}, meta: { workspace: { order: 0 } } })
  expect(errors).toEqual([])
  expect(document.querySelector('workspace-dock#workspace > .dock-area')).toBeNull()
})
