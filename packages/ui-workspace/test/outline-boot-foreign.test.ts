// Boot from a stored document naming a provider on another origin: the import confirm is asked before its code loads
// (ADR-0034); Cancel loads nothing, and neither the stored document nor its pages are saved over.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('a foreign provider in the stored document is confirmed at boot; cancelled, nothing loads and nothing is saved over', async () => {
  const KEY = 'nano-workspace.document', at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  const stored = JSON.stringify({ pods: {}, runtimes: {}, modules: { 'nano.ui': at, 'evil.x': 'https://evil.test/x.js' }, views: {} })
  localStorage.setItem(KEY, stored)
  // happy-dom fetches no blob: URL (a browser does): the boot reads the stored document through one
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : (domFetch as Function)(u, ...rest)) as never
  const booting = import('../src/boot-host.ts')
  for (let i = 0; i < 200 && !document.querySelector('dialog'); i++) await tick(5)
  const dialog = document.querySelector('dialog')!
  expect(dialog.textContent).toContain('Import from another origin?')
  expect(dialog.textContent).toContain('https://evil.test/x.js')
  ;[...dialog.querySelectorAll('button')].find(b => b.textContent === 'Cancel')!.click()
  const { host } = await booting
  expect(host!.registry.provider('evil.x')).toBeUndefined()
  expect(document.querySelector('[data-nano-status]')).not.toBeNull()
  await tick(400)
  expect(localStorage.getItem(KEY)).toBe(stored)
  expect(localStorage.getItem('nano-workspace.outline')).toBeNull()
})
