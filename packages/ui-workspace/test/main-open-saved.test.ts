// File › Save, then Open (Review Focus 5): the bundle opens to the same pages. In the same browser, the pages are
// applied by the workspace's rules (an identical Main is skipped), so nothing is duplicated.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('save the bundle, then open it: the same pages, nothing duplicated', async () => {
  const html = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  document.body.innerHTML = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('<script type="module">'))
  location.hash = '#/p/two'
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  const pages = { roots: ['workspace'], pages: {
    workspace: { title: 'Main', slots: { x: { kind: 'tool', tool: 'systems' } }, layout: { workspace: { root: { type: 'row', content: [] }, 'window-style': 'clear' } }, meta: { workspace: { saved: { root: { type: 'column', content: [] } } } }, children: ['two'] },
    two: { title: 'Two', slots: {} },
  } }
  localStorage.setItem('nano-workspace.document', JSON.stringify({ pods: {}, runtimes: {}, modules: { 'nano.ui': at }, views: {} }))
  localStorage.setItem('nano-workspace.outline', JSON.stringify(pages))
  // happy-dom fetches no blob: URL (a browser does); the saved file is served as an example
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  let saved: Blob | undefined
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : u.endsWith('examples/saved/nano.json') ? new Response(saved) : (domFetch as Function)(u, ...rest)) as never
  HTMLAnchorElement.prototype.click = function () {}   // a download (happy-dom would navigate to it)
  await import('../src/main.ts')
  const { outline, host } = await import('../src/boot-host.ts')
  const p = outline!, now = () => JSON.parse(JSON.stringify(p.document().doc))
  const before = blobs.size
  document.dispatchEvent(new CustomEvent('file:save'))
  saved = [...blobs.values()][before]!
  const file = JSON.parse(await saved.text())
  expect(Object.keys(file)).toEqual(['app', 'outline', 'host'])   // the HostDocument
  const was = now()   // as saved: the shown dock's arrangement written in
  expect(file.outline).toEqual(was)
  expect(was.pages.workspace).toEqual(pages.pages.workspace)
  const applied = new Promise<void>(r => host!.app.listen(e => { if (e.type === 'applied') r() }))
  document.dispatchEvent(new CustomEvent('file:example', { detail: { name: 'saved' } }))
  await applied; await tick(20)
  expect(now()).toEqual(was)   // identical pages skipped
  expect(host!.document().host?.layout).toEqual(file.host.layout)
})
