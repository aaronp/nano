// A reload (Review Focus 1): the stored app document and its pages boot the same pages, layouts and pods; nothing is
// made or started for a page not shown. A pod undeployed since leaves its slot in the pages (it resolves missing).
// The pages stored flat under the old key, in the old `meta.workspace.order` (Review Focus 2), boot as the same tree,
// saved under the one key, the old ones removed; its view slot (a widget id) as its tool's.
import { expect, test } from 'bun:test'
import { Pod, type AppDeployment } from '@pritzlaff/nano-core'
import './host-deploy-setup.ts'

const { log } = await import('@pritzlaff/nano-ui')
const KEY = 'nano-workspace.document', OLD = 'nano-workspace.platform', PAGES = 'nano-workspace.outline'

test('a reload restores the pages and pods as saved, nothing started; an undeployed pod\'s slot stays, missing', async () => {
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  const app: AppDeployment = { pods: { log1: Pod.lazy(log), log2: Pod.lazy(log) }, runtimes: { main: { pods: ['log1'], subscriptions: [] }, side: { pods: ['log2'], subscriptions: [] } }, modules: { 'nano.ui': at }, views: {}, layout: { ring: { show: [] } } }
  const pages = { pages: {
    workspace: { title: 'Main', slots: { a: { kind: 'pod', pod: 'nano.ui/log@main/log1' }, x: { kind: 'view', view: 'nano-explorer' } }, layout: { workspace: { root: { type: 'row' } } }, meta: { workspace: { order: 0, saved: { root: null } } } },
    two: { title: 'Two', slots: { b: { kind: 'pod', pod: 'nano.ui/log@side/log2' }, any: { kind: 'select', select: { runtime: 'side' } } }, meta: { workspace: { icon: 'star', order: 1 } } },
  } }
  localStorage.setItem(KEY, JSON.stringify(app)); localStorage.setItem(OLD, JSON.stringify(pages))
  // happy-dom fetches no blob: URL (a browser does): the boot reads the stored document through one
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : (domFetch as Function)(u, ...rest)) as never
  const { host, outline } = await import('../src/boot-host.ts')
  if (!host || !outline) throw new Error('the host did not start')
  expect(document.querySelector('dialog')).toBeNull()
  const tree = { roots: ['workspace', 'two'], pages: { workspace: { ...pages.pages.workspace, slots: { ...pages.pages.workspace.slots, x: { kind: 'tool', tool: 'systems' } }, meta: { workspace: { saved: { root: null } } } }, two: { ...pages.pages.two, meta: { workspace: { icon: 'star' } } } } }
  expect(JSON.parse(JSON.stringify(outline.document().doc))).toEqual(tree)   // stored flat: every page a root, in the old order, the order dropped
  expect(Object.keys(host.data().pods)).toEqual(['ui', 'deploy', 'outline', 'log1', 'log2'])
  expect(host.document().host?.layout).toEqual({ workspace: { ring: { show: [] } } })
  for (const [r, p] of [['main', 'log1'], ['side', 'log2']] as const) expect(host.app.runtime(r).status(p)).toEqual({ ok: true, value: 'not started' })
  expect(Object.keys(outline.resolve('two'))).toEqual(['b', 'any'])
  const d = host.data()
  expect(await host.apply({ ...d, pods: Object.fromEntries(Object.entries(d.pods).filter(([p]) => p !== 'log1')), runtimes: { ...d.runtimes, main: { ...d.runtimes['main']!, pods: d.runtimes['main']!.pods.filter(p => p !== 'log1') } } })).toMatchObject({ ok: true })
  expect(outline.resolve('workspace')['a']).toEqual({ kind: 'missing' })
  const stored = JSON.parse(localStorage.getItem('nano-host.document')!)
  expect(Object.keys(stored.app.pods)).toEqual(['log2'])
  expect(stored.outline).toEqual(tree)   // the slot kept: it shows "not found" until removed
  for (const k of [KEY, OLD, PAGES]) expect(localStorage.getItem(k)).toBeNull()
})
