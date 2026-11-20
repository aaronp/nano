// The workspace's rules for its pages (lib/pages.ts): Main first, the rest by `meta.order`; a reorder rewrites the
// orders that change; an apply that drops Main or adds a fixed route is refused before it reaches the Platform.
import { expect, test } from 'bun:test'
import { flat } from './flat.ts'
import { Application, AppDeployment, Registry, type NanoResult } from '@pritzlaff/nano-core'
import { Outline } from '@pritzlaff/nano-outline'
import { applyPages, moved, ordered, refusal, slugPath } from '../src/lib/pages.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const at = (order?: number) => ({ title: 'T', slots: {}, ...(order !== undefined && { meta: { workspace: { order } } }) })
const doc: Outline = flat({ b: at(2), workspace: at(5), a: at(1), none: at() })

test('ordered: Main first, then by meta.order, a page without one last', () => {
  expect(ordered(doc)).toEqual(['workspace', 'a', 'b', 'none'])
})

test('moved: the page at its new place, each page whose place changed given it as meta.order; Main and its place refused', () => {
  const next = moved(doc, 'b', 1)!
  expect(ordered(next)).toEqual(['workspace', 'b', 'a', 'none'])
  expect(Object.fromEntries(Object.entries(next.pages).map(([id, p]) => [id, (p.meta as { workspace: { order: number } }).workspace.order]))).toEqual({ workspace: 0, b: 1, a: 2, none: 3 })
  expect(next.pages['b']).toEqual({ title: 'T', slots: {}, meta: { workspace: { order: 1 } } })
  expect(moved(doc, 'workspace', 1)).toBeUndefined()
  expect(moved(doc, 'a', 0)).toBeUndefined()
  expect(moved(doc, 'a', 4)).toBeUndefined()
  expect(moved(doc, 'gone', 1)).toBeUndefined()
})

test('refusal and applyPages: Main dropped or a fixed route added is refused, unapplied; a fixed route already there is kept', async () => {
  const registry = Registry.create(), app = must(await Application.create(must(AppDeployment.assemble({ pods: {}, runtimes: {} }, registry))))
  const platform = Outline.create(app, registry, flat({ workspace: at(0) }))
  expect(refusal(platform.document().doc, flat({}))).toBe('Main (the page workspace) is not removed')
  for (const id of ['ring', 'desk', 'settings', 'systems', 'messages', 'components', 'themes', 'inbox'])
    expect(applyPages(platform, flat({ workspace: at(0), [id]: at(1) }))).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: `${id} is the workspace's own route, not a page` } })
  expect(platform.document().version).toBe(0)
  expect(refusal(flat({ workspace: at(0), ring: at(1) }), flat({ workspace: at(0), ring: at(2) }))).toBeUndefined()
  expect(applyPages(platform, flat({ workspace: at(0), two: at(1) }))).toEqual({ ok: true, value: undefined })
  await app.close()
})

test('slugPath slugs a title and avoids taken routes', () => {
  expect(slugPath('My Desk', ['/my-desk'])).toBe('/my-desk-2')
  expect(slugPath('My Desk', ['/my-desk', '/my-desk-2'])).toBe('/my-desk-3')
  expect(slugPath('  ', [])).toBe('/workspace-page')
})
