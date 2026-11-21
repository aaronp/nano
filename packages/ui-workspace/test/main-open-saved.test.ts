// File › Save, then Open (Review Focus 5): the bundle opens to the same pages. In the same browser, the pages are
// applied by the workspace's rules (an identical Main is skipped), so nothing is duplicated; after New (Main emptied,
// then showing only its starter view), opening it fills Main from the file.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('save the bundle, then open it: the same pages, nothing duplicated; after New, opening it fills Main', async () => {
  const html = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  document.body.innerHTML = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('<script type="module">'))
  location.hash = '#/p/two'
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  const pages = { roots: ['workspace'], pages: {
    workspace: { title: 'Main', slots: { x: { kind: 'view', view: 'nano-explorer' } }, layout: { workspace: { root: { type: 'row', content: [] }, 'window-style': 'clear' } }, meta: { workspace: { saved: { root: { type: 'column', content: [] } } } }, children: ['two'] },
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
  expect(Object.keys(file)).toEqual(['app', 'outline'])
  const was = now()   // as saved: the shown dock's arrangement written in
  expect(file.outline).toEqual(was)
  expect(was.pages.workspace).toEqual(pages.pages.workspace)
  const applied = new Promise<void>(r => host!.app.listen(e => { if (e.type === 'applied') r() }))
  document.dispatchEvent(new CustomEvent('file:example', { detail: { name: 'saved' } }))
  await applied; await tick(20)
  expect(now()).toEqual(was)   // identical pages skipped
  expect(host!.data().layout).toEqual(file.app.layout)
  // New empties Main; shown, its dock's starter panel (the explorer) writes a view slot back. Opening the saved file
  // then fills Main from the file's Main (views alone are the starter), not a workspace-2 beside it.
  document.dispatchEvent(new CustomEvent('file:new'))
  for (let i = 0; i < 200 && Object.keys(p.document().doc.pages['workspace']!.slots).length; i++) await tick(5)
  expect(now().pages.workspace.slots).toEqual({})
  location.hash = '#/p/workspace'
  for (let i = 0; i < 200 && !Object.keys(p.document().doc.pages['workspace']!.slots).length; i++) await tick(5)
  expect(now().pages.workspace.slots).toEqual({ 'nano-explorer': { kind: 'view', view: 'nano-explorer' } })   // the starter
  const again = new Promise<void>(r => host!.app.listen(e => { if (e.type === 'applied') r() }))
  document.dispatchEvent(new CustomEvent('file:example', { detail: { name: 'saved' } }))
  await again; await tick(50)
  expect(now().pages.workspace).toEqual(pages.pages.workspace)
  expect(Object.keys(now().pages)).toEqual(['workspace', 'two'])
  expect(now().roots).toEqual(['workspace'])   // Main's child kept, not placed twice
})
