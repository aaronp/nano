// The workspace's rules for an import's pages (withImported): free ids added last, identical pages skipped, clashing
// ids suffixed, and an incoming Main filling a Main that shows only views.
import { expect, test } from 'bun:test'
import { Outline } from '@pritzlaff/nano-outline'
import { withImported } from '../src/import-pages.ts'

const doc = (w: unknown): Outline => { const r = Outline.parse(w); if (!r.ok) throw new Error(r.fail.reason); return r.value }
const written = (v: unknown) => JSON.parse(JSON.stringify(v))
const view = { kind: 'view', view: 'nano-explorer' }, pod = { kind: 'pod', pod: 'example.clock/clock@main/clock1' }
const main = { slots: { x: view }, title: 'Workspace', meta: { workspace: { order: 0 } } }, trading = { slots: {}, title: 'Trading', meta: { workspace: { order: 0 } } }
const ids = (d: Outline) => Object.entries(d.pages).map(([id, p]) => [id, p.title, (p.meta as { workspace: { order: number } }).workspace.order])

test('a free id is added last; a taken id with identical content (its order aside) is skipped, so a repeat is a no-op', () => {
  const once = withImported(doc({ pages: { workspace: main } }), doc({ pages: { trading } }))
  expect(ids(once)).toEqual([['workspace', 'Workspace', 0], ['trading', 'Trading', 1]])
  expect(written(withImported(once, doc({ pages: { trading } })))).toEqual(written(once))
})

test('a taken id with other content is added as -2, -3…, in the file\'s order; the incoming Main is not a Main that shows a pod', () => {
  const full = doc({ pages: { workspace: { ...main, slots: { x: view, c: pod } }, trading: { ...trading, meta: { workspace: { order: 1 } } } } })
  const out = withImported(full, doc({ pages: { trading: { slots: {}, title: 'Third', meta: { workspace: { order: 2 } } }, t2: { slots: {}, title: 'Other', meta: { workspace: { order: 1 } } }, workspace: { slots: { c: pod }, title: 'Imported', meta: { workspace: { order: 0 } } } } }))
  expect(ids(out)).toEqual([['workspace', 'Workspace', 0], ['trading', 'Trading', 1], ['workspace-2', 'Imported', 2], ['t2', 'Other', 3], ['trading-2', 'Third', 4]])
})

test('the incoming Main fills a Main that shows only views (after New): its slots, layout and meta, first still', () => {
  const saved = { slots: { c: pod }, layout: { workspace: { root: 2 } }, title: 'Main', meta: { workspace: { order: 0 } } }
  const out = withImported(doc({ pages: { workspace: { ...main, layout: { workspace: { root: 1 } } }, two: { slots: {}, title: 'Two', meta: { workspace: { order: 1 } } } } }), doc({ pages: { workspace: saved } }))
  expect(written(out.pages['workspace'])).toEqual(saved)
  expect(Object.keys(out.pages)).toEqual(['workspace', 'two'])
})

test('an incoming Main filling Main keeps Main\'s other clients\' layout and meta keys; the workspace\'s keys and the slots are the file\'s', () => {
  const was = { ...main, layout: { workspace: { root: 1 }, react: { columns: 3 } }, meta: { workspace: { order: 0, icon: 'home' }, react: { x: 1 } } }
  const file = { title: 'Main', slots: { c: pod }, layout: { workspace: { root: 2 }, react: { columns: 9 } }, meta: { workspace: { order: 4, icon: 'star' }, other: 2 } }
  expect(written(withImported(doc({ pages: { workspace: was } }), doc({ pages: { workspace: file } })).pages['workspace'])).toEqual(
    { title: 'Main', slots: { c: pod }, layout: { workspace: { root: 2 }, react: { columns: 3 } }, meta: { workspace: { order: 0, icon: 'star' }, react: { x: 1 } } })
})

test('an incoming page on one of the workspace\'s own routes is taken as clashing: added as -2, the rest of the import kept', () => {
  const out = withImported(doc({ pages: { workspace: main } }), doc({ pages: { ring: trading, two: { slots: {}, title: 'Two', meta: { workspace: { order: 1 } } } } }))
  expect(Object.keys(out.pages)).toEqual(['workspace', 'ring-2', 'two'])
})

test('a plain nano.json\'s Main filling Main keeps Main\'s title, icon, view slots, layout (the file has none) and other clients\' keys', async () => {
  const { importing } = await import('../src/import-pages.ts')
  const app = { listen: () => () => {}, deployment: () => ({ pods: {}, runtimes: {} }) } as never
  const platform = Outline.create(app, {} as never, doc({ pages: { workspace: { slots: { x: view }, layout: { workspace: { root: 1 }, react: { columns: 3 } }, title: 'Mine', meta: { workspace: { icon: 'star', order: 0 }, react: { x: 1 } } } } }))
  const file = { pods: { clock1: { implementation: 'example.clock/clock' } }, runtimes: { main: { pods: ['clock1'], subscriptions: [] } }, layout: { pages: [{ id: 'workspace', title: 'Workspace', slots: [{ id: 'c', runtime: 'main', pod: 'clock1' }] }] } }
  const url = `data:application/json,${encodeURIComponent(JSON.stringify(file))}`
  expect(await importing(async () => ({ ok: true, value: undefined }), platform)(url)).toMatchObject({ ok: true })
  expect(written(platform.document().doc)).toEqual({ roots: ['workspace'], pages: { workspace: { slots: { x: view, c: pod }, layout: { workspace: { root: 1 }, react: { columns: 3 } }, title: 'Mine', meta: { workspace: { icon: 'star', order: 0 }, react: { x: 1 } } } } })
})
