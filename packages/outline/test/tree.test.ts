// The Outline's tree: `roots` and each page's `children`, checked whole by `parse`; HostOutline's `changed`. (The live
// outline's `moved` report is the host core's: packages/host/test/outline-live.test.ts.)
import { expect, test } from 'bun:test'
import { type NanoResult } from '@pritzlaff/nano-core'
import { HostOutline, Outline } from '../src/index.ts'

const ok = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const strs = (v: unknown) => JSON.parse(JSON.stringify(v))
/** A document from `roots` and each page's children (`{ a: ['b'] }`); every page named is made. */
const tree = (roots: string[], children: Record<string, string[]> = {}, also: string[] = []): Outline => {
  const ids = new Set([...roots, ...Object.keys(children), ...Object.values(children).flat(), ...also])
  return { roots, pages: Object.fromEntries([...ids].map(id => [id, { slots: {}, ...(children[id] && { children: children[id] }) }])) }
}

test('a tree is accepted and kept as written', () => {
  const doc = tree(['a', 'b'], { a: ['c', 'd'], d: ['e'] })
  expect(strs(ok(Outline.parse(strs(doc))))).toEqual(strs(doc))
})

test('parse refuses a missing id, a page in two places, a cycle and an orphan, naming the page', () => {
  const refused = (next: Outline, page: string) => {
    expect(Outline.parse(strs(next))).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: expect.stringContaining(`page ${page}`) } })
  }
  refused({ roots: ['a', 'ghost'], pages: { a: { slots: {} } } }, 'ghost')
  refused({ roots: ['a'], pages: { a: { slots: {}, children: ['ghost'] } } }, 'ghost')
  refused(tree(['a', 'b'], { a: ['b'] }), 'b')
  refused(tree(['a'], { a: ['b', 'b'] }), 'b')
  refused(tree(['a'], { b: ['c'], c: ['b'] }), 'b')
  refused(tree(['a'], { b: ['b'] }), 'b')
  refused(tree(['a'], { under: [], b: ['c', 'under'], c: ['b'] }), 'b')   // a page under a cycle: the cycle's page is named
  refused({ roots: ['a', 'toString'], pages: { a: { slots: {} } } }, 'toString')
  refused({ roots: ['a'], pages: { a: { slots: {}, children: ['constructor'] } } }, 'constructor')
  refused(tree(['a'], {}, ['lost']), 'lost')
})

test('a flat { pages } parses as every page a root, in document order', () => {
  const r = ok(Outline.parse({ pages: { z: { slots: {} }, a: { slots: {} }, m: { slots: {}, title: 'M' } } }))
  expect(r.roots).toEqual(['z', 'a', 'm'])
  expect(r.pages.m!.title).toBe('M')
  expect(Outline.parse({ roots: 'a', pages: {} })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  expect(Outline.parse({ pages: { a: { slots: {}, children: 'b' } } })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
})

test('HostOutline declares a changed event beside document and apply', () => {
  expect(HostOutline.coord).toBe('nano.outline.HostOutline')
  expect(Object.keys(HostOutline.ops).sort()).toEqual(['apply', 'changed', 'document'])
  expect(HostOutline.ops.changed.kind).toBe('event')
})
