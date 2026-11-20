// An old stored document (its pages in `layout.pages`, no stored pages) migrates once: the Platform holds the pages and
// the document is saved without them. An import's pages (a plain nano.json's `layout.pages`) are applied to the
// Platform by the workspace's rules, never kept in the app's layout, so a page deleted since does not come back.
import { expect, test } from 'bun:test'
import { Pod } from '@pritzlaff/nano-core'
import { tick } from './host-deploy-setup.ts'

const { log } = await import('@pritzlaff/nano-ui')
const KEY = 'nano-workspace.document', PAGES = 'nano-workspace.platform'
const strs = (v: unknown) => JSON.parse(JSON.stringify(v))

test('an old stored document migrates once: pages into the Platform (pod slots by coordinate), the document saved without them', async () => {
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  const pages = [{ id: 'workspace', title: 'Workspace', slots: [{ id: 'a', runtime: 'main', pod: 'log1' }] }, { id: 'trading', title: 'Trading', icon: 'chart', slots: [{ id: 'n', view: 'nano-explorer' }] }]
  const doc = { pods: { log1: Pod.lazy(log) }, runtimes: { main: { pods: ['log1'], subscriptions: [] } }, modules: { 'nano.ui': at }, views: {}, layout: { pages, ring: { show: [] } } }
  localStorage.setItem(KEY, JSON.stringify(doc))
  // happy-dom fetches no blob: URL (a browser does)
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : (domFetch as Function)(u, ...rest)) as never
  const { host, platform } = await import('../src/boot-host.ts')
  if (!host || !platform) throw new Error('the host did not start')
  const migrated = { pages: {
    workspace: { title: 'Workspace', slots: { a: { kind: 'pod', pod: 'nano.ui/log@main/log1' } }, meta: { workspace: { order: 0 } } },
    trading: { title: 'Trading', slots: { n: { kind: 'view', view: 'nano-explorer' } }, meta: { workspace: { icon: 'chart', order: 1 } } },
  } }
  expect(strs(platform.document().doc)).toEqual(migrated)
  expect(host.data().layout).toEqual({ ring: { show: [] } })   // other keys kept, no pages
  for (let i = 0; i < 50 && !localStorage.getItem(PAGES); i++) await tick(20)
  expect(JSON.parse(localStorage.getItem(KEY)!).layout).toEqual({ ring: { show: [] } })
  expect(JSON.parse(localStorage.getItem(PAGES)!)).toEqual(migrated)
  // deleted, then a file with no layout imported: it stays gone
  const { trading: _, ...rest } = platform.document().doc.pages
  expect(platform.apply({ pages: rest })).toMatchObject({ ok: true })
  const none = URL.createObjectURL(new Blob([JSON.stringify({ pods: {}, runtimes: {}, modules: { 'nano.ui': at }, views: {} })]))
  expect(await host.importUrl(none)).toMatchObject({ ok: true })
  expect(Object.keys(platform.document().doc.pages)).toEqual(['workspace'])
})

test('an import with pages applies them to the Platform and keeps none in the layout: delete one, import a file with no layout, it stays gone', async () => {
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href, file = (layout?: object) => URL.createObjectURL(new Blob([JSON.stringify({ pods: {}, runtimes: {}, modules: { 'nano.ui': at }, views: {}, ...(layout && { layout }) })]))
  const { host, platform } = await import('../src/boot-host.ts')
  if (!host || !platform) throw new Error('the host did not start')
  const notes = { id: 'notes', title: 'Notes', slots: [{ id: 'n', view: 'nano-explorer' }] }, mine = { id: 'mine', title: 'Mine', slots: [] }
  const ids = () => Object.keys(platform.document().doc.pages)
  expect(await host.importUrl(file({ pages: [notes, mine] }))).toMatchObject({ ok: true })
  expect(ids()).toEqual(['workspace', 'notes', 'mine'])
  expect((host.data().layout as { pages?: unknown } | undefined)?.pages).toBeUndefined()
  const { notes: _, ...rest } = platform.document().doc.pages
  platform.apply({ pages: rest })
  expect(await host.importUrl(file())).toMatchObject({ ok: true })
  expect(ids()).toEqual(['workspace', 'mine'])
  expect(await host.importUrl(file({ pages: [notes] }))).toMatchObject({ ok: true })   // the same file again: its page is added back
  expect(ids()).toEqual(['workspace', 'mine', 'notes'])
  expect(await host.importUrl(file({ pages: [notes] }))).toMatchObject({ ok: true })   // and once more: identical, skipped
  expect(ids()).toEqual(['workspace', 'mine', 'notes'])
})
