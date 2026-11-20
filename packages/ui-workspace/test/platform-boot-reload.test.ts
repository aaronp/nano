// A reload (Review Focus 1): the stored app document and its pages boot the same pages, layouts and pods; nothing is
// made or started for a page not shown. A pod undeployed since leaves its slot in the pages (it resolves missing), and
// the store the nav and docks read shows what resolves.
import { expect, test } from 'bun:test'
import { Pod, type AppDeployment } from '@pritzlaff/nano-core'
import { tick } from './host-deploy-setup.ts'

const { log } = await import('@pritzlaff/nano-ui')
const KEY = 'nano-workspace.document', PAGES = 'nano-workspace.platform'

test('a reload restores the pages and pods as saved, nothing started; an undeployed pod\'s slot stays, missing', async () => {
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  const app: AppDeployment = { pods: { log1: Pod.lazy(log), log2: Pod.lazy(log) }, runtimes: { main: { pods: ['log1'], subscriptions: [] }, side: { pods: ['log2'], subscriptions: [] } }, modules: { 'nano.ui': at }, views: {}, layout: { ring: { show: [] } } }
  const pages = { pages: {
    workspace: { slots: { a: { kind: 'pod', pod: 'nano.ui/log@main/log1' }, x: { kind: 'view', view: 'nano-explorer' } }, layout: { root: { type: 'row' } }, meta: { title: 'Main', order: 0, saved: { root: null } } },
    two: { slots: { b: { kind: 'pod', pod: 'nano.ui/log@side/log2' }, any: { kind: 'select', select: { runtime: 'side' } } }, meta: { title: 'Two', icon: 'star', order: 1 } },
  } }
  localStorage.setItem(KEY, JSON.stringify(app)); localStorage.setItem(PAGES, JSON.stringify(pages))
  // happy-dom fetches no blob: URL (a browser does): the boot reads the stored document through one
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : (domFetch as Function)(u, ...rest)) as never
  const { host, platform, pages: store } = await import('../src/boot-host.ts')
  if (!host || !platform) throw new Error('the host did not start')
  expect(document.querySelector('dialog')).toBeNull()
  expect(JSON.parse(JSON.stringify(platform.document().doc))).toEqual(pages)
  expect(Object.keys(host.data().pods)).toEqual(['ui', 'deploy', 'platform', 'log1', 'log2'])
  expect(host.data().layout).toEqual({ ring: { show: [] } })
  for (const [r, p] of [['main', 'log1'], ['side', 'log2']] as const) expect(host.app.runtime(r).status(p)).toEqual({ ok: true, value: 'not started' })
  expect(store.list()).toEqual([
    { id: 'workspace', title: 'Main', slots: [{ id: 'a', runtime: 'main', pod: 'log1' }, { id: 'x', view: 'nano-explorer' }], workspace: { root: { type: 'row' }, saved: { root: null } } },
    { id: 'two', title: 'Two', icon: 'star', slots: [{ id: 'b', runtime: 'side', pod: 'log2' }, { id: 'any', runtime: 'side', pod: 'log2' }] },
  ])
  const d = host.data()
  expect(await host.apply({ ...d, pods: Object.fromEntries(Object.entries(d.pods).filter(([p]) => p !== 'log1')), runtimes: { ...d.runtimes, main: { ...d.runtimes['main']!, pods: d.runtimes['main']!.pods.filter(p => p !== 'log1') } } })).toMatchObject({ ok: true })
  expect(platform.resolve('workspace')['a']).toEqual({ kind: 'missing' })
  expect(store.get('workspace')!.slots).toEqual([{ id: 'x', view: 'nano-explorer' }])
  for (let i = 0; i < 50 && JSON.parse(localStorage.getItem(KEY)!).pods.log1; i++) await tick(20)
  expect(Object.keys(JSON.parse(localStorage.getItem(KEY)!).pods)).toEqual(['log2'])
  expect(JSON.parse(localStorage.getItem(PAGES)!)).toEqual(pages)   // the slot kept: it shows "not found" until removed
})
