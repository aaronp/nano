// File › Save writes `layout.pages` and, beside them, the legacy `workspace`/`slots`/`geometry`. Opening that file in
// the same browser: the pages merge (an identical Main is skipped) and the legacy keys are dropped with them, so Main
// is not replaced (its restore point and window style kept) and no "Workspace" page is added. After New (Main
// emptied, then showing only its starter view), opening it fills Main from the file.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('save the document, then open it: Main is kept as it was and nothing is duplicated; after New, opening it fills Main', async () => {
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
  // New empties Main; shown, its dock's starter panel (the explorer) writes a view slot back. Opening the saved file
  // then fills Main from the file's Main (views alone are the starter), not a workspace-2 beside it.
  document.dispatchEvent(new CustomEvent('file:new'))
  for (let i = 0; i < 200 && store.get('workspace')!.slots.length; i++) await tick(5)
  expect(store.get('workspace')!.slots).toEqual([])
  location.hash = '#/workspace'
  for (let i = 0; i < 200 && !store.get('workspace')!.slots.length; i++) await tick(5)
  expect(store.get('workspace')!.slots.map(s => 'view' in s && s.view)).toEqual(['nano-explorer'])   // the starter
  const again = new Promise<void>(r => { let n = 0; host!.app.listen(e => { if (e.type === 'applied' && ++n === 2) r() }) })
  document.dispatchEvent(new CustomEvent('file:example', { detail: { name: 'saved' } }))
  await again; await tick(50)
  expect(store.get('workspace')!.slots).toEqual(main.slots)
  expect(store.get('workspace')!.title).toBe('Main')
  expect(store.list().map(p => p.id)).toEqual(['workspace', 'two'])
})
