// Bad migrated data never stops the boot: a stored document whose old pages hold a slot with a bad id ("my slot") or a
// bad coordinate (runtime `a@b`) boots with those slots dropped, and a status says so.
import { expect, test } from 'bun:test'
import { Pod } from '@pritzlaff/nano-core'
import { tick } from './host-deploy-setup.ts'

const { log } = await import('@pritzlaff/nano-ui')

test('a stored document with a bad slot id and a bad coordinate boots; those slots are dropped, with a status', async () => {
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  const slots = [{ id: 'my slot', view: 'nano-explorer' }, { id: 'p', runtime: 'a@b', pod: 'log1' }, { id: 'ok', runtime: 'main', pod: 'log1' }]
  const doc = { pods: { log1: Pod.lazy(log) }, runtimes: { main: { pods: ['log1'], subscriptions: [] } }, modules: { 'nano.ui': at }, views: {}, layout: { pages: [{ id: 'workspace', title: 'Workspace', slots }] } }
  localStorage.setItem('nano-workspace.document', JSON.stringify(doc))
  // happy-dom fetches no blob: URL (a browser does)
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : (domFetch as Function)(u, ...rest)) as never
  const { host, outline } = await import('../src/boot-host.ts')
  if (!host || !outline) throw new Error('the host did not start')
  expect(JSON.parse(JSON.stringify(outline.document().doc.pages['workspace']!.slots))).toEqual({ ok: { kind: 'pod', pod: 'nano.ui/log@main/log1' } })
  await tick(50)
  expect([...document.querySelectorAll('[data-nano-status]')].map(e => e.textContent).join()).toContain('old pages are gone')
})
