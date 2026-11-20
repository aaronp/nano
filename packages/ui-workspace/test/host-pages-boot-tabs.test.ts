// The stored document's autosave: flushed on `pagehide`; and once another tab writes the document (a `storage` event
// for its key), this tab saves it no more and says to reload, so the last writer does not silently win.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

const KEY = 'nano-workspace.document'
const stored = () => JSON.parse(localStorage.getItem(KEY)!).layout.pages.map((p: { id: string }) => p.id)

test('pagehide flushes a pending save; a write from another tab stops saving here and says so', async () => {
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  localStorage.setItem(KEY, JSON.stringify({ pods: {}, runtimes: {}, modules: { 'nano.ui': at }, views: {}, layout: { pages: [{ id: 'workspace', title: 'Workspace', slots: [] }] } }))
  // happy-dom fetches no blob: URL (a browser does)
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : (domFetch as Function)(u, ...rest)) as never
  const { host, pages } = await import('../src/boot-host.ts')
  if (!host) throw new Error('the host did not start')
  await tick(400)
  pages.set({ id: 'one', title: 'One', slots: [] })
  expect(stored()).toEqual(['workspace'])   // debounced
  dispatchEvent(new Event('pagehide'))
  expect(stored()).toEqual(['workspace', 'one'])   // flushed
  dispatchEvent(new StorageEvent('storage', { key: 'something.else' }))
  pages.set({ id: 'two', title: 'Two', slots: [] })
  await tick(400)
  expect(stored()).toEqual(['workspace', 'one', 'two'])   // another key: still saving
  dispatchEvent(new StorageEvent('storage', { key: KEY }))
  await tick(50)
  expect(document.querySelector('[data-nano-status]')?.textContent).toContain('changed in another tab')
  pages.set({ id: 'three', title: 'Three', slots: [] })
  await tick(400)
  dispatchEvent(new Event('pagehide'))
  expect(stored()).toEqual(['workspace', 'one', 'two'])   // saved no more
})
