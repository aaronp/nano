// Boot from a stored document with pages: the store holds them, the host's kept layout does not, so a page deleted
// from the store is not brought back by a later import of a document with no layout.
import { expect, test } from 'bun:test'
import './host-deploy-setup.ts'

test('a page deleted after boot does not come back with an import that has no layout', async () => {
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  const pages = [{ id: 'workspace', title: 'Workspace', slots: [] }, { id: 'trading', title: 'Trading', slots: [{ id: 'n', view: 'nano-explorer' }] }]
  const doc = { pods: {}, runtimes: {}, modules: { 'nano.ui': at }, views: {}, layout: { pages, ring: { show: [] } } }
  localStorage.setItem('nano-workspace.document', JSON.stringify(doc))
  // happy-dom fetches no blob: URL (a browser does)
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : (domFetch as Function)(u, ...rest)) as never
  const { host, pages: store } = await import('../src/boot-host.ts')
  if (!host) throw new Error('the host did not start')
  expect(store.list().map(p => p.id)).toEqual(['workspace', 'trading'])
  expect((host.data().layout as { pages?: unknown; ring?: unknown })).toEqual({ ring: { show: [] } })   // other keys kept, no pages
  expect(store.remove('trading')).toMatchObject({ ok: true })
  const none = URL.createObjectURL(new Blob([JSON.stringify({ pods: {}, runtimes: {}, modules: { 'nano.ui': at }, views: {} })]))
  expect(await host.importUrl(none)).toMatchObject({ ok: true })
  expect((host.data().layout as { pages?: unknown } | undefined)?.pages).toBeUndefined()   // main.ts merges only an array
  expect(store.get('trading')).toBeUndefined()
})
