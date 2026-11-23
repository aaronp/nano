// The File menu with Main's dock never built (a deep link to another page): Save writes the host document (the app's
// nano.json, the Outline's pages and the host part), and New asks (Cancel, or a download first), then reloads to clear it.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('a deep link to another page: Save writes the bundle; New asks, offers a download, then reloads', async () => {
  const html = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  document.body.innerHTML = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('<script type="module">'))
  location.hash = '#/two'
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href, layout = { root: { type: 'row', content: [] }, 'window-style': 'focus' }
  const pages = { roots: ['workspace', 'two'], pages: { workspace: { title: 'Main', slots: { notes: { kind: 'tool', tool: 'notes' } }, layout: { workspace: layout, react: { columns: 3 } }, meta: { workspace: { icon: 'home' } } }, two: { title: 'Two', slots: {} } } }
  const app = { pods: {}, runtimes: {}, modules: { 'nano.ui': at }, views: {} }
  localStorage.setItem('nano-workspace.document', JSON.stringify(app)); localStorage.setItem('nano-workspace.outline', JSON.stringify(pages))
  // happy-dom fetches no blob: URL (a browser does); the downloads are kept
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : (domFetch as Function)(u, ...rest)) as never
  HTMLAnchorElement.prototype.click = function () {}   // a download (happy-dom would navigate to it)
  const errors: unknown[] = []
  addEventListener('error', e => errors.push((e as ErrorEvent).error)); addEventListener('unhandledrejection', e => errors.push((e as PromiseRejectionEvent).reason))
  await import('../src/main.ts')
  const { outline } = await import('../src/boot-host.ts')
  expect(document.querySelector('workspace-dock#workspace > .dock-area')).toBeNull()   // Main not built
  const before = blobs.size
  document.dispatchEvent(new CustomEvent('file:save'))
  const file = JSON.parse(await [...blobs.values()][before]!.text())
  const { views: _, ...system } = app
  expect(file.app).toMatchObject(system)   // the host document's app: its views are `host.views`
  expect(file.outline).toEqual(JSON.parse(JSON.stringify(outline!.document().doc)))   // the Outline's pages (the shown dock's arrangement written in)
  expect(file.outline.pages.workspace).toEqual(pages.pages.workspace)
  let reloads = 0
  ;(location as unknown as { reload(): void }).reload = () => { reloads++ }
  const answer = async (label: string) => {
    document.dispatchEvent(new CustomEvent('file:new'))
    await tick(5)
    const d = document.querySelector('dialog[aria-label="New workspace"]')!
    ;[...d.querySelectorAll('button')].find(b => b.textContent === label)!.click()
    await tick(320)
  }
  await answer('Cancel')
  expect([sessionStorage.getItem('nano-host.wipe'), reloads]).toEqual([null, 0])   // cancelled: nothing cleared
  const downloads = blobs.size
  await answer('Download, then start new')
  expect(blobs.size).toBe(downloads + 1)   // the copy, first
  expect(JSON.parse(await [...blobs.values()].at(-1)!.text()).outline.pages.workspace).toEqual(pages.pages.workspace)
  expect([sessionStorage.getItem('nano-host.wipe'), reloads]).toEqual(['1', 1])
  expect(errors).toEqual([])
  expect(document.querySelector('workspace-dock#workspace > .dock-area')).toBeNull()
})
