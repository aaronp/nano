// File › Save writes `layout.pages` and, beside them, the legacy `workspace`/`slots`/`geometry`. Opening that file in
// the same browser: the pages merge (an identical Main is skipped) and the legacy keys are dropped with them, so Main
// is not replaced (its restore point and window style kept) and no "Workspace" page is added.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('save the document, then open it: Main is kept as it was and nothing is duplicated', async () => {
  const html = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  document.body.innerHTML = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('<script type="module">'))
  location.hash = '#/two'
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  const engine = { root: { type: 'row', content: [] }, saved: { root: { type: 'column', content: [] } }, 'window-style': 'clear' }
  const main = { id: 'workspace', title: 'Main', slots: [{ id: 'x', view: 'nano-explorer' }], workspace: engine }
  localStorage.setItem('nano-workspace.document', JSON.stringify({ pods: {}, runtimes: {}, modules: { 'nano.ui': at }, views: {}, layout: { pages: [main, { id: 'two', title: 'Two', slots: [] }] } }))
  // happy-dom fetches no blob: URL (a browser does); the saved file is served as an example
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  let saved: Blob | undefined
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : u.endsWith('examples/saved/nano.json') ? new Response(saved) : (domFetch as Function)(u, ...rest)) as never
  HTMLAnchorElement.prototype.click = function () {}   // a download (happy-dom would navigate to it)
  await import('../src/main.ts')
  const { pages: store, host } = await import('../src/boot-host.ts')
  const before = blobs.size
  document.dispatchEvent(new CustomEvent('file:save'))
  saved = [...blobs.values()][before]!
  const file = JSON.parse(await saved.text())
  expect(file.layout.workspace).toBeDefined()   // the legacy keys are in the file
  expect(file.layout.pages.map((p: { id: string }) => p.id)).toEqual(['workspace', 'two'])
  const applied = new Promise<void>(r => { let n = 0; host!.app.listen(e => { if (e.type === 'applied' && ++n === 2) r() }) })   // the import's, then the clearing one
  document.dispatchEvent(new CustomEvent('file:example', { detail: { name: 'saved' } }))
  await applied; await tick(20)
  expect(store.get('workspace')).toEqual(main)
  expect(store.list().map(p => p.id)).toEqual(['workspace', 'two'])
  const kept = host!.data().layout ?? {}
  expect(['pages', 'workspace', 'slots', 'geometry'].filter(k => kept[k] !== undefined)).toEqual([])
})
