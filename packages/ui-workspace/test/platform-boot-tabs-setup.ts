// The stored documents' autosave: flushed on `pagehide`; and once another tab writes the document or its pages (a
// `storage` event for either key), this tab saves them no more and says to reload, so the last writer does not silently win.
import { expect } from 'bun:test'
import { flat } from './flat.ts'
import { tick } from './host-deploy-setup.ts'

export const KEY = 'nano-workspace.document', PAGES = 'nano-workspace.platform'
const stored = () => Object.keys(JSON.parse(localStorage.getItem(PAGES)!).pages)

/** Pagehide flushes a pending save; a write from another tab to `key` stops saving here and says so. */
export async function anotherTab(key: string) {
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  localStorage.setItem(KEY, JSON.stringify({ pods: {}, runtimes: {}, modules: { 'nano.ui': at }, views: {} }))
  localStorage.setItem(PAGES, JSON.stringify({ pages: { workspace: { slots: {} } } }))
  // happy-dom fetches no blob: URL (a browser does)
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : (domFetch as Function)(u, ...rest)) as never
  const { host, platform } = await import('../src/boot-host.ts')
  if (!host || !platform) throw new Error('the host did not start')
  const add = (id: string) => platform.apply(flat({ ...platform.document().doc.pages, [id]: { slots: {} } }))
  await tick(400)
  add('one')
  expect(stored()).toEqual(['workspace'])   // debounced
  dispatchEvent(new Event('pagehide'))
  expect(stored()).toEqual(['workspace', 'one'])   // flushed
  dispatchEvent(new StorageEvent('storage', { key: 'something.else' }))
  add('two')
  await tick(400)
  expect(stored()).toEqual(['workspace', 'one', 'two'])   // another key: still saving
  dispatchEvent(new StorageEvent('storage', { key }))
  await tick(50)
  expect(document.querySelector('[data-nano-status]')?.textContent).toContain('changed in another tab')
  add('three')
  await tick(400)
  dispatchEvent(new Event('pagehide'))
  expect(stored()).toEqual(['workspace', 'one', 'two'])   // saved no more
}
