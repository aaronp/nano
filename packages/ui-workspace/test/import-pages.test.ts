// The workspace's rules for an import's pages (withImported): free ids added (incoming roots appended to the roots),
// identical pages skipped, clashing ids suffixed (in the incoming lists too), an incoming Main filling a Main that shows
// only tools (keeping Main's children), and an incoming child of a page kept as identical appended to its children.
import { expect, test } from 'bun:test'
import { Outline } from '@pritzlaff/nano-outline'
import { withImported } from '../src/import-pages.ts'

const doc = (w: unknown): Outline => { const r = Outline.parse(w); if (!r.ok) throw new Error(r.fail.reason); return r.value }
const written = (v: unknown) => JSON.parse(JSON.stringify(v))
const view = { kind: 'tool', tool: 'systems' }, pod = { kind: 'pod', pod: 'example.clock/clock@main/clock1' }
const main = { slots: { x: view }, title: 'Workspace' }, trading = { slots: {}, title: 'Trading' }
const ids = (d: Outline) => Object.entries(d.pages).map(([id, p]) => [id, p.title])
const lists = (o: Outline): Record<string, string[]> => ({ roots: o.roots, ...Object.fromEntries(Object.entries(o.pages).flatMap(([id, q]) => q.children?.length ? [[id, q.children]] : [])) })

test('a free id is added, a root last; a taken id with identical content is skipped, so a repeat is a no-op', () => {
  const once = withImported(doc({ pages: { workspace: main } }), doc({ pages: { trading } }))
  expect(ids(once)).toEqual([['workspace', 'Workspace'], ['trading', 'Trading']])
  expect(once.roots).toEqual(['workspace', 'trading'])
  expect(written(withImported(once, doc({ pages: { trading } })))).toEqual(written(once))
})

test('a taken id with other content is added as -2, -3…, in the file\'s tree order, renamed in its lists; the incoming Main is not a Main that shows a pod', () => {
  const full = doc({ pages: { workspace: { ...main, slots: { x: view, c: pod } }, trading } })
  const out = withImported(full, doc({ roots: ['t2', 'trading'], pages: { trading: { slots: {}, title: 'Third', children: ['workspace'] }, t2: { slots: {}, title: 'Other' }, workspace: { slots: { c: pod }, title: 'Imported' } } }))
  expect(ids(out)).toEqual([['workspace', 'Workspace'], ['trading', 'Trading'], ['t2', 'Other'], ['trading-2', 'Third'], ['workspace-2', 'Imported']])
  expect(lists(out)).toEqual({ roots: ['workspace', 'trading', 't2', 'trading-2'], 'trading-2': ['workspace-2'] })
})

test('the incoming Main fills a Main that shows only tools (after New): its slots, layout and meta; Main keeps its children, the file Main\'s appended', () => {
  const saved = { slots: { c: pod }, layout: { workspace: { root: 2 } }, title: 'Main', children: ['fresh'] }
  const out = withImported(doc({ roots: ['workspace'], pages: { workspace: { ...main, layout: { workspace: { root: 1 } }, children: ['two'] }, two: { slots: {}, title: 'Two' } } }),
    doc({ roots: ['workspace'], pages: { workspace: saved, fresh: { slots: {}, title: 'Fresh' } } }))
  expect(written(out.pages['workspace'])).toEqual({ ...saved, children: ['two', 'fresh'] })
  expect(lists(out)).toEqual({ roots: ['workspace'], workspace: ['two', 'fresh'] })
})

test('an incoming child of a page kept as identical (its children aside) is appended to that page\'s children; a kept child is not placed twice', () => {
  const current = doc({ roots: ['workspace', 'trading'], pages: { workspace: main, trading: { ...trading, children: ['a'] }, a: { slots: {}, title: 'A' } } })
  const out = withImported(current, doc({ roots: ['trading'], pages: { trading: { ...trading, children: ['a', 'b', 'c'] }, a: { slots: {}, title: 'A' }, b: { slots: {}, title: 'B' }, c: { slots: {}, title: 'C', children: ['a2'] }, a2: { slots: {}, title: 'A2' } } }))
  expect(lists(out)).toEqual({ roots: ['workspace', 'trading'], trading: ['a', 'b', 'c'], c: ['a2'] })
})

test('an incoming Main filling Main keeps Main\'s other clients\' layout and meta keys; the workspace\'s keys and the slots are the file\'s', () => {
  const was = { ...main, layout: { workspace: { root: 1 }, react: { columns: 3 } }, meta: { workspace: { icon: 'home' }, react: { x: 1 } } }
  const file = { title: 'Main', slots: { c: pod }, layout: { workspace: { root: 2 }, react: { columns: 9 } }, meta: { workspace: { icon: 'star' }, other: 2 } }
  expect(written(withImported(doc({ pages: { workspace: was } }), doc({ pages: { workspace: file } })).pages['workspace'])).toEqual(
    { title: 'Main', slots: { c: pod }, layout: { workspace: { root: 2 }, react: { columns: 3 } }, meta: { workspace: { icon: 'star' }, react: { x: 1 } } })
})

test('an incoming page `ring` is just a page: added as ring, the rest of the import kept', () => {
  const out = withImported(doc({ pages: { workspace: main } }), doc({ pages: { ring: trading, two: { slots: {}, title: 'Two' } } }))
  expect(Object.keys(out.pages)).toEqual(['workspace', 'ring', 'two'])
  expect(out.roots).toEqual(['workspace', 'ring', 'two'])
})

test('a plain nano.json\'s Main filling Main keeps Main\'s title, icon, tool slots, children, layout (the file has none) and other clients\' keys', async () => {
  const { importing } = await import('../src/import-pages.ts')
  const app = { listen: () => () => {}, deployment: () => ({ pods: {}, runtimes: {} }) } as never
  const outline = Outline.create(app, {} as never, doc({ roots: ['workspace'], pages: { workspace: { slots: { x: view }, children: ['kid'], layout: { workspace: { root: 1 }, react: { columns: 3 } }, title: 'Mine', meta: { workspace: { icon: 'star' }, react: { x: 1 } } }, kid: { slots: {} } } }))
  const file = { pods: { clock1: { implementation: 'example.clock/clock' } }, runtimes: { main: { pods: ['clock1'], subscriptions: [] } }, layout: { pages: [{ id: 'workspace', title: 'Workspace', slots: [{ id: 'c', runtime: 'main', pod: 'clock1' }] }] } }
  const url = `data:application/json,${encodeURIComponent(JSON.stringify(file))}`
  expect(await importing(async () => ({ ok: true, value: undefined }), outline)(url)).toMatchObject({ ok: true })
  expect(written(outline.document().doc)).toEqual({ roots: ['workspace'], pages: { workspace: { slots: { x: view, c: pod }, children: ['kid'], layout: { workspace: { root: 1 }, react: { columns: 3 } }, title: 'Mine', meta: { workspace: { icon: 'star' }, react: { x: 1 } } }, kid: { slots: {} } } })
})

test('an incoming id that a suffix of this import took is suffixed again, whether its content is the same as that page or not', () => {
  const third = { slots: {}, title: 'Third' }
  for (const next of [third, { slots: {}, title: 'Fourth' }]) {
    const out = withImported(doc({ pages: { workspace: main, trading } }), doc({ roots: ['trading', 'trading-2'], pages: { trading: third, 'trading-2': next } }))
    expect(ids(out)).toEqual([['workspace', 'Workspace'], ['trading', 'Trading'], ['trading-2', 'Third'], ['trading-2-2', next.title]])
    expect(out.roots).toEqual(['workspace', 'trading', 'trading-2', 'trading-2-2'])
  }
})
