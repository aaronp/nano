// The Outline's tree: `roots` and each page's `children`, checked whole; `moved` in the change report; HostOutline's `changed`.
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, success, type NanoResult } from '@pritzlaff/nano-core'
import { HostOutline, Outline } from '../src/index.ts'

const ok = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const registry = Registry.create()
const live = async () => ok(await Application.create(ok(AppDeployment.assemble({ pods: {}, runtimes: {} }, registry))))
const strs = (v: unknown) => JSON.parse(JSON.stringify(v))
/** A document from `roots` and each page's children (`{ a: ['b'] }`); every page named is made. */
const tree = (roots: string[], children: Record<string, string[]> = {}, also: string[] = []): Outline => {
  const ids = new Set([...roots, ...Object.keys(children), ...Object.values(children).flat(), ...also])
  return { roots, pages: Object.fromEntries([...ids].map(id => [id, { slots: {}, ...(children[id] && { children: children[id] }) }])) }
}

test('a tree is accepted and kept as written', async () => {
  const doc = tree(['a', 'b'], { a: ['c', 'd'], d: ['e'] })
  const p = Outline.create(await live(), registry, doc)
  expect(strs(p.document().doc)).toEqual(strs(doc))
})

test('apply refuses a missing id, a page in two places, a cycle and an orphan, naming the page; nothing changes', async () => {
  const p = Outline.create(await live(), registry, tree(['a']))
  const refused = (next: Outline, page: string) => {
    expect(p.apply(next)).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: expect.stringContaining(`page ${page}`) } })
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
  expect(strs(p.document())).toEqual({ doc: strs(tree(['a'])), version: 0 })
  expect(() => Outline.create(p as never, registry, tree(['a'], {}, ['lost']))).toThrow(/page lost/)
})

test('a flat { pages } parses as every page a root, in document order', () => {
  const r = ok(Outline.parse({ pages: { z: { slots: {} }, a: { slots: {} }, m: { slots: {}, title: 'M' } } }))
  expect(r.roots).toEqual(['z', 'a', 'm'])
  expect(r.pages.m!.title).toBe('M')
  expect(Outline.parse({ roots: 'a', pages: {} })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  expect(Outline.parse({ pages: { a: { slots: {}, children: 'b' } } })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
})

test('the report names pages moved: reorder, reparent, roots only; a parent whose children alone changed is not changed', async () => {
  const p = Outline.create(await live(), registry, tree(['a', 'b', 'c'], { a: ['x', 'y'] }))
  const heard: unknown[] = []
  p.listen(c => heard.push(c))
  ok(p.apply(tree(['b', 'a', 'c'], { a: ['x', 'y'] })))                       // roots only
  ok(p.apply(tree(['b', 'a', 'c'], { a: ['y', 'x'] })))                       // reorder among siblings
  ok(p.apply(tree(['b', 'a', 'c'], { a: ['y'], c: ['x'] })))                  // reparent
  ok(p.apply(tree(['n', 'b', 'a', 'c'], { a: ['y'], c: ['x'] })))             // a page added before the rest: none moved
  expect(heard).toEqual([
    { added: [], removed: [], changed: [], moved: ['b', 'a'], resolved: [] },
    { added: [], removed: [], changed: [], moved: ['y', 'x'], resolved: [] },
    { added: [], removed: [], changed: [], moved: ['x'], resolved: [] },
    { added: ['n'], removed: [], changed: [], moved: [], resolved: [] },
  ])
  expect(p.document().version).toBe(4)
  expect(p.apply(tree(['n', 'b', 'a', 'c'], { a: ['y'], c: ['x'] }))).toEqual(success(undefined))
  expect(p.document().version).toBe(4)
})

test('a moved page keeps its id, slots, resolution and open', async () => {
  const doc = tree(['a', 'b'], { a: ['v'] })
  doc.pages.v!.slots = { s: { kind: 'tool', tool: 'systems' } }
  const p = Outline.create(await live(), registry, doc)
  const next = tree(['a', 'b'], { b: ['v'] })
  ok(p.apply({ ...next, pages: { ...next.pages, v: doc.pages.v! } }))
  expect(p.resolve('v')).toEqual({ s: { kind: 'tool', tool: 'systems' } })
  expect(await p.open('v')).toEqual({ s: { kind: 'tool', tool: 'systems' } })
})

test('HostOutline declares a changed event beside document and apply', () => {
  expect(HostOutline.coord).toBe('nano.outline.HostOutline')
  expect(Object.keys(HostOutline.ops).sort()).toEqual(['apply', 'changed', 'document'])
  expect(HostOutline.ops.changed.kind).toBe('event')
})
