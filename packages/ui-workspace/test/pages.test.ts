// The workspace's rules for its pages (lib/pages.ts): order is the tree (walk, move, subtree, parentOf, without); Main
// is the first root; an apply that drops Main, moves it from first root, or adds a fixed route is refused before it
// reaches the Outline.
import { expect, test } from 'bun:test'
import { flat } from './flat.ts'
import { Application, AppDeployment, Registry, type NanoResult } from '@pritzlaff/nano-core'
import { Outline, type Page } from '@pritzlaff/nano-outline'
import { applyPages, move, parentOf, refusal, slugPath, subtree, walk, without } from '../src/lib/pages.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const p = (...children: string[]): Page => ({ slots: {}, ...(children.length && { children }) })
// workspace(x) · a(b(c)) · d
const doc: Outline = { roots: ['workspace', 'a', 'd'], pages: { workspace: p('x'), x: p(), a: p('b'), b: p('c'), c: p(), d: p() } }
const lists = (o: Outline): Record<string, string[]> => ({ roots: o.roots, ...Object.fromEntries(Object.entries(o.pages).flatMap(([id, q]) => q.children?.length ? [[id, q.children]] : [])) })

test('walk: the tree depth first, roots in order; parentOf: a page\'s parent, undefined for a root; subtree: a page and all below it', () => {
  expect(walk(doc)).toEqual(['workspace', 'x', 'a', 'b', 'c', 'd'])
  expect([parentOf(doc, 'c'), parentOf(doc, 'x'), parentOf(doc, 'a')]).toEqual(['b', 'workspace', undefined])
  expect(subtree(doc, 'a')).toEqual(['a', 'b', 'c'])
  expect(subtree(doc, 'd')).toEqual(['d'])
})

test('move: to a parent and an index, the lists in step and the page kept; Main, Main\'s place, a cycle, a bad place or page refused', () => {
  expect(lists(move(doc, 'd', 'a', 0)!)).toEqual({ roots: ['workspace', 'a'], workspace: ['x'], a: ['d', 'b'], b: ['c'] })
  expect(lists(move(doc, 'b', undefined, 1)!)).toEqual({ roots: ['workspace', 'b', 'a', 'd'], workspace: ['x'], b: ['c'] })
  expect(lists(move(doc, 'a', undefined, 2)!)).toEqual({ roots: ['workspace', 'd', 'a'], workspace: ['x'], a: ['b'], b: ['c'] })   // after its removal
  expect(lists(move(doc, 'c', 'workspace', 1)!)).toEqual({ roots: ['workspace', 'a', 'd'], workspace: ['x', 'c'], a: ['b'] })   // Main may have children
  expect(move(doc, 'd', 'a', 0)!.pages['d']).toBe(doc.pages['d']!)
  for (const bad of [move(doc, 'workspace', undefined, 1), move(doc, 'a', undefined, 0), move(doc, 'a', 'c', 0), move(doc, 'a', 'a', 0),
    move(doc, 'd', undefined, 3), move(doc, 'd', 'a', 2), move(doc, 'gone', undefined, 1), move(doc, 'd', 'gone', 0)]) expect(bad).toBeUndefined()
})

test('without: a page and its subtree gone, from the pages and its parent\'s list; Main and an unknown page refused', () => {
  const out = without(doc, 'a')!
  expect(lists(out)).toEqual({ roots: ['workspace', 'd'], workspace: ['x'] })
  expect(Object.keys(out.pages)).toEqual(['workspace', 'x', 'd'])
  expect(lists(without(doc, 'x')!)).toEqual({ roots: ['workspace', 'a', 'd'], a: ['b'], b: ['c'] })
  expect(without(doc, 'workspace')).toBeUndefined()
  expect(without(doc, 'gone')).toBeUndefined()
})

test('refusal and applyPages: Main dropped, not a root or not first, or a fixed route added, is refused, unapplied; a fixed route already there is kept', async () => {
  const registry = Registry.create(), app = must(await Application.create(must(AppDeployment.assemble({ pods: {}, runtimes: {} }, registry))))
  const outline = Outline.create(app, registry, flat({ workspace: p() }))
  expect(refusal(outline.document().doc, flat({}))).toBe('Main (the page workspace) is not removed')
  expect(refusal(doc, { ...doc, roots: ['a', 'workspace', 'd'] })).toBe('Main (the page workspace) stays the first page')
  expect(refusal(doc, { roots: ['a', 'd'], pages: { ...doc.pages, a: p('b', 'workspace') } })).toBe('Main (the page workspace) stays the first page')
  for (const id of ['ring', 'desk', 'settings', 'systems', 'messages', 'components', 'themes', 'inbox'])
    expect(applyPages(outline, flat({ workspace: p(), [id]: p() }))).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: `${id} is the workspace's own route, not a page` } })
  expect(applyPages(outline, { roots: ['two', 'workspace'], pages: { workspace: p(), two: p() } })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  expect(outline.document().version).toBe(0)
  expect(refusal(flat({ workspace: p(), ring: p() }), flat({ workspace: p(), ring: { slots: {}, title: 'R' } }))).toBeUndefined()
  expect(applyPages(outline, { roots: ['workspace'], pages: { workspace: p('two'), two: p() } })).toEqual({ ok: true, value: undefined })
  await app.close()
})

test('slugPath slugs a title and avoids taken routes', () => {
  expect(slugPath('My Desk', ['/my-desk'])).toBe('/my-desk-2')
  expect(slugPath('My Desk', ['/my-desk', '/my-desk-2'])).toBe('/my-desk-3')
  expect(slugPath('  ', [])).toBe('/workspace-page')
})
