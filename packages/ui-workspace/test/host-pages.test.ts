// HostPages in the workspace: the pod `pages` over the page store (a pod's change asks first), and the boot from the
// stored document: the pages seeded from it, kept in step with the system (an undeployed pod leaves every page), saved.
import { expect, jest, test } from 'bun:test'
import { Application, AppDeployment, Coord, Pod, Registry, type NanoResult } from '@pritzlaff/nano-core'
import type { Page } from '@pritzlaff/nano-ui'
import { tick } from './host-deploy-setup.ts'

const { log } = await import('@pritzlaff/nano-ui')
const { hostPages, pagesPod } = await import('../src/host-pages.ts')
const { hostProvider } = await import('../src/host-deploy.ts')
const { hostUi } = await import('../src/host-ui.ts')
const { pageStore } = await import('../src/lib/pages.ts')

type Pages = {
  pages(n: null): Promise<NanoResult<Page[]>>; setPage(a: { page: Page; index?: number }): Promise<NanoResult<unknown>>
  removePage(a: { id: string }): Promise<NanoResult<unknown>>; open(a: { id: string }): Promise<NanoResult<unknown>>
}
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const trading: Page = { id: 'trading', title: 'Trading', slots: [] }

async function pagesApp(answer: () => Promise<boolean>) {
  const store = pageStore([], () => true), asked: string[] = [], registry = Registry.create()
  registry.add(Coord.namespace('workspace.host').provider([hostPages(store, t => { asked.push(t); return answer() })]))
  const d: AppDeployment = { pods: { pages: pagesPod }, runtimes: { main: { pods: ['pages'], subscriptions: [] } } }
  const app = must(await Application.create(must(AppDeployment.assemble(d, registry))))
  return { store, asked, app, pages: app.call('main', 'pages') as unknown as Pages }
}

test('a setPage or removePage asks first: a yes changes the pages, a no does not', async () => {
  let yes = true
  const { store, asked, app, pages } = await pagesApp(async () => yes)
  expect(must(await pages.setPage({ page: trading }))).toBeNull()
  expect(store.list().map(p => p.id)).toEqual(['workspace', 'trading'])
  yes = false
  expect(await pages.setPage({ page: { ...trading, title: 'Markets' } })).toMatchObject({ ok: false, fail: { type: 'denied' } })
  expect(await pages.removePage({ id: 'trading' })).toMatchObject({ ok: false, fail: { type: 'denied' } })
  expect(store.get('trading')?.title).toBe('Trading')
  expect(asked).toEqual(['Add page "Trading" showing nothing', 'Change page "Markets" showing nothing', 'Remove page "Trading"'])
  asked.length = 0
  yes = true
  await pages.setPage({ page: { ...trading, slots: [{ id: 'n', view: 'nano-explorer' }, { id: 'p', runtime: 'main', pod: 'pages' }] } })
  expect(asked).toEqual(['Change page "Trading" showing nano-explorer, pages'])   // the pod-supplied title quoted, what it shows named
  await app.close()
})

test('through hostProvider, the ask is the ui pod\'s dialog, and no answer within 20 s is a no', async () => {
  const store = pageStore([], () => true), registry = Registry.create()
  let app: Application | undefined
  registry.add(hostProvider(() => app!, store))
  const d: AppDeployment = { pods: { ui: Pod.eager(hostUi), pages: pagesPod }, runtimes: { main: { pods: ['ui', 'pages'], subscriptions: [] } } }
  app = must(await Application.create(must(AppDeployment.assemble(d, registry))))
  jest.useFakeTimers()
  try {
    const r = (app.call('main', 'pages') as unknown as Pages).setPage({ page: trading })
    for (let i = 0; i < 50 && !document.querySelector('dialog'); i++) { await Promise.resolve(); jest.advanceTimersByTime(1) }
    expect(document.querySelector('dialog')?.textContent).toContain('Add page "Trading" showing nothing')
    jest.advanceTimersByTime(20_000)
    expect(await r).toMatchObject({ ok: false, fail: { type: 'denied' } })
  } finally { jest.useRealTimers() }
  expect(store.get('trading')).toBeUndefined()
  document.querySelector('dialog')?.remove()
  await app.close()
})

test('removing Main is refused; pages and open are not asked; open shows the page', async () => {
  const { store, asked, app, pages } = await pagesApp(async () => true)
  expect(await pages.removePage({ id: 'workspace' })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  asked.length = 0
  store.set(trading)
  expect(must(await pages.pages(null)).map(p => p.id)).toEqual(['workspace', 'trading'])
  expect(must(await pages.open({ id: 'trading' }))).toBeNull()
  expect(location.hash).toBe('#/trading')
  expect(await pages.open({ id: 'nope' })).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  expect(asked).toEqual([])
  await app.close()
})

test('boot: the stored document is loaded and its pages seeded; a pod undeployed leaves both pages showing it, saved', async () => {
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href, KEY = 'nano-workspace.document'
  const slot = { id: 'a', runtime: 'main', pod: 'log1' }
  const stored: AppDeployment = {
    pods: { log1: Pod.lazy(log), log2: Pod.lazy(log) }, runtimes: { main: { pods: ['log1', 'log2'], subscriptions: [] } }, modules: { 'nano.ui': at }, views: {},
    layout: { pages: [{ id: 'workspace', title: 'Workspace', slots: [slot] }, { id: 'two', title: 'Two', slots: [slot, { id: 'b', runtime: 'main', pod: 'log2' }] }] },
  }
  localStorage.setItem(KEY, JSON.stringify(stored))
  // happy-dom fetches no blob: URL (a browser does): the boot reads the stored document through one
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : (domFetch as Function)(u, ...rest)) as never
  const { host, pages } = await import('../src/boot-host.ts')
  if (!host) throw new Error('the host did not start')
  expect(document.querySelector('dialog')).toBeNull()   // the app's own document, nano.ui only: nothing asked
  expect(Object.keys(host.data().pods)).toEqual(['ui', 'deploy', 'pages', 'log1', 'log2'])
  expect(pages.list()).toEqual(stored.layout!['pages'] as Page[])
  // the pod `pages` answers from the same store, unasked
  expect(must(await (host.app.call('main', 'pages') as unknown as Pages).pages(null)).map(p => p.id)).toEqual(['workspace', 'two'])
  const d = host.data()
  must(await host.apply({ ...d, pods: Object.fromEntries(Object.entries(d.pods).filter(([p]) => p !== 'log1')), runtimes: { main: { ...d.runtimes['main']!, pods: d.runtimes['main']!.pods.filter(p => p !== 'log1') } } }))
  expect(pages.list().map(p => p.slots)).toEqual([[], [{ id: 'b', runtime: 'main', pod: 'log2' }]])
  for (let i = 0; i < 50 && JSON.parse(localStorage.getItem(KEY)!).pods.log1; i++) await tick(20)
  const saved = JSON.parse(localStorage.getItem(KEY)!) as AppDeployment
  expect(Object.keys(saved.pods)).toEqual(['log2'])   // without the host's own pods
  expect(saved.layout!['pages']).toEqual(pages.list())
})
