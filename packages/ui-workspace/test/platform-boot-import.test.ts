// An import whose runtime the Import dialog renames keeps its slots valid: the file's pages name the runtime it lands
// in (its pod coordinates and selectors rewritten as its runtimes are), so every slot resolves. A bundle opens as a
// plain nano.json does.
import { expect, test } from 'bun:test'
import { Pod, type AppDeployment } from '@pritzlaff/nano-core'
import type { Outline } from '@pritzlaff/nano-outline'
import './host-deploy-setup.ts'

const { log } = await import('@pritzlaff/nano-ui')
const { renameRuntimes, selectPods } = await import('../src/import-plan.ts')

test('an import with a renamed runtime: the bundle\'s pod slots and selectors name the new runtime and resolve', async () => {
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : (domFetch as Function)(u, ...rest)) as never
  const { host, platform } = await import('../src/boot-host.ts')
  if (!host || !platform) throw new Error('the host did not start')
  const app: AppDeployment = { pods: { l1: Pod.lazy(log), l2: Pod.lazy(log) }, runtimes: { main: { pods: ['l1', 'l2'], subscriptions: [] } }, modules: { 'nano.ui': at }, views: {} }
  const pages = { pages: { logs: { slots: { a: { kind: 'pod', pod: 'nano.ui/log@main/l1' }, b: { kind: 'pod', pod: 'nano.ui/log@main/l2' }, s: { kind: 'select', select: { runtime: 'main' } } }, meta: { title: 'Logs', order: 0 } } } }
  const url = URL.createObjectURL(new Blob([JSON.stringify({ app, platform: pages })]))
  const names = { main: 'acme.main' }, only = new Set(['l1'])
  const chosen = { edit: (f: AppDeployment) => renameRuntimes(selectPods(f, only).deployment, names), pages: (p: Outline) => renameRuntimes(selectPods(p, only), names) }
  expect(await host.importUrl(url, chosen)).toMatchObject({ ok: true })
  expect(host.data().runtimes['acme.main']!.pods).toEqual(['l1'])
  expect(JSON.parse(JSON.stringify(platform.document().doc.pages['logs']!.slots))).toEqual({ a: { kind: 'pod', pod: 'nano.ui/log@acme.main/l1' }, s: { kind: 'select', select: { runtime: 'acme.main' } } })
  expect(Object.values(platform.resolve('logs')).map(r => r.kind)).toEqual(['pod', 'pod'])
})
