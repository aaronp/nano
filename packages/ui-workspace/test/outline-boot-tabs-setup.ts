// The host document's autosave (the host core's, on every change): once another tab writes it (a `storage` event for
// the one key, or an old one), this tab saves it no more and says to reload, so the last writer does not silently win.
import { expect } from 'bun:test'
import { flat } from './flat.ts'
import { tick } from './host-deploy-setup.ts'

export const KEY = 'nano-host.document', OLD = 'nano-workspace.outline'
const stored = () => Object.keys(JSON.parse(localStorage.getItem(KEY)!).outline.pages)

/** A write from another tab to `key` stops saving here and says so. */
export async function anotherTab(key: string) {
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  localStorage.setItem(KEY, JSON.stringify({ app: { pods: {}, runtimes: {}, modules: { 'nano.ui': at } }, outline: { pages: { workspace: { slots: {} } } } }))
  const { host, outline } = await import('../src/boot-host.ts')
  if (!host || !outline) throw new Error('the host did not start')
  const add = (id: string) => outline.apply(flat({ ...outline.document().doc.pages, [id]: { slots: {} } }))
  add('one')
  expect(stored()).toEqual(['workspace', 'one'])   // saved at once
  dispatchEvent(new StorageEvent('storage', { key: 'something.else' }))
  add('two')
  expect(stored()).toEqual(['workspace', 'one', 'two'])   // another key: still saving
  dispatchEvent(new StorageEvent('storage', { key }))
  await tick(10)
  expect(document.querySelector('[data-nano-status]')?.textContent).toContain('changed in another tab')
  add('three')
  expect(stored()).toEqual(['workspace', 'one', 'two'])   // saved no more
}
