// host.ts over the host core: an import keeps other clients' `host.layout` keys (ADR-0039); an isolated nano.ui pod
// applied without `modules` (as `deploy` applies) still finds nano.ui's URL and runs in a frame.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'
import { serve } from '../src/sandbox/serve.ts'

const { log } = await import('@pritzlaff/nano-ui')
const { start } = await import('../src/host.ts')
const Real = MessageChannel
globalThis.MessageChannel = class extends Real { constructor() { super(); serve(this.port2, async () => log) } }
// happy-dom fetches no blob: URL (a browser does)
const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : (domFetch as Function)(u, ...rest)) as never

test('an import keeps another client\'s layout key, the file\'s keys added', async () => {
  const r = await start()
  if (!r.ok) throw new Error(r.fail.reason)
  const h = r.value, at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  h.setHost({ layout: { react: { columns: 2 } } })
  const file = URL.createObjectURL(new Blob([JSON.stringify({ pods: {}, runtimes: {}, modules: { 'nano.ui': at }, layout: { ring: { show: [] } } })]))
  expect(await h.importUrl(file)).toMatchObject({ ok: true })
  expect(h.document().host?.layout).toEqual({ react: { columns: 2 }, workspace: { ring: { show: [] } } })
})

test('an isolated nano.ui pod applied with no modules on a fresh workspace runs in a frame', async () => {
  const r = await start()
  if (!r.ok) throw new Error(r.fail.reason)
  const h = r.value, d = h.app.deployment()
  expect(h.document().app.modules).toBeUndefined()   // fresh: nothing recorded
  const main = d.runtimes['main']!
  expect(await h.app.apply({ ...d, pods: { ...d.pods, s1: { implementation: 'nano.ui/log', eager: false, isolation: 'isolated-sandbox' } }, runtimes: { ...d.runtimes, main: { ...main, pods: [...main.pods, 's1'] } } })).toMatchObject({ ok: true })
  const got = await h.app.runtime('main').getOrCreate('s1')
  expect(got.ok).toBe(true)
  await tick(10)
  expect(h.app.runtime('main').status('s1')).toEqual({ ok: true, value: 'running' })
})
