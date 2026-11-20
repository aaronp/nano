// The workspace's rules for an import's pages (withImported): free ids added last, identical pages skipped, clashing
// ids suffixed, and an incoming Main filling a Main that shows only views.
import { expect, test } from 'bun:test'
import { Platform, type UIDeployment } from '@pritzlaff/nano-platform'
import { withImported } from '../src/import-pages.ts'

const doc = (w: unknown): UIDeployment => { const r = Platform.parse(w); if (!r.ok) throw new Error(r.fail.reason); return r.value }
const written = (v: unknown) => JSON.parse(JSON.stringify(v))
const view = { kind: 'view', view: 'nano-explorer' }, pod = { kind: 'pod', pod: 'example.clock/clock@main/clock1' }
const main = { slots: { x: view }, meta: { title: 'Workspace', order: 0 } }, trading = { slots: {}, meta: { title: 'Trading', order: 0 } }
const ids = (d: UIDeployment) => Object.entries(d.pages).map(([id, p]) => [id, (p.meta as { title: string; order: number }).title, (p.meta as { order: number }).order])

test('a free id is added last; a taken id with identical content (its order aside) is skipped, so a repeat is a no-op', () => {
  const once = withImported(doc({ pages: { workspace: main } }), doc({ pages: { trading } }))
  expect(ids(once)).toEqual([['workspace', 'Workspace', 0], ['trading', 'Trading', 1]])
  expect(written(withImported(once, doc({ pages: { trading } })))).toEqual(written(once))
})

test('a taken id with other content is added as -2, -3…, in the file\'s order; the incoming Main is not a Main that shows a pod', () => {
  const full = doc({ pages: { workspace: { ...main, slots: { x: view, c: pod } }, trading: { ...trading, meta: { title: 'Trading', order: 1 } } } })
  const out = withImported(full, doc({ pages: { trading: { slots: {}, meta: { title: 'Third', order: 2 } }, t2: { slots: {}, meta: { title: 'Other', order: 1 } }, workspace: { slots: { c: pod }, meta: { title: 'Imported', order: 0 } } } }))
  expect(ids(out)).toEqual([['workspace', 'Workspace', 0], ['trading', 'Trading', 1], ['workspace-2', 'Imported', 2], ['t2', 'Other', 3], ['trading-2', 'Third', 4]])
})

test('the incoming Main fills a Main that shows only views (after New): its slots, layout and meta, first still', () => {
  const saved = { slots: { c: pod }, layout: { root: 2 }, meta: { title: 'Main', order: 0 } }
  const out = withImported(doc({ pages: { workspace: { ...main, layout: { root: 1 } }, two: { slots: {}, meta: { title: 'Two', order: 1 } } } }), doc({ pages: { workspace: saved } }))
  expect(written(out.pages['workspace'])).toEqual(saved)
  expect(Object.keys(out.pages)).toEqual(['workspace', 'two'])
})
