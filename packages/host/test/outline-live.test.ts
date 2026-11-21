// The host core's live outline (moved from the Outline package with `Outline.create`): one document, one `apply`, slots
// resolved against the Application and opened with `getOrCreate`; and the Outline's pure `resolve`, which it is built on.
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import {
  Application, AppDeployment, Coord, Implementation, Interface, Op, Pod, Provider, Registry, Schema, provide, success,
  type NanoResult,
} from '@pritzlaff/nano-core'
import { resolve, type Outline } from '@pritzlaff/nano-outline'
import { live as outlineOf } from '../src/outline-live.ts'

const Num = Schema.define(Type.Integer(), 'Num')
const Counter = Interface.define('acme.Counter', { inc: Op.action(Num, Num) })
let builds = 0
const counter = Implementation.define('acme/counter', { provides: [Counter], make: async () => { builds++; return [provide(Counter, { inc: async (n: number) => success(n + 1) })] } })
const broken = Implementation.define('acme/broken', { provides: [Counter], make: async () => { throw new Error('cannot build') } })
const registry = Registry.create(); registry.add(Provider.define('acme', [counter, broken]))

const ok = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const base: AppDeployment = {
  pods: { a: Pod.lazy(counter), b: Pod.lazy(counter), x: Pod.lazy(broken) },
  runtimes: { s: { pods: ['b'], subscriptions: [] }, r: { pods: ['a', 'x'], subscriptions: [] } },
}
const live = async () => ok(await Application.create(ok(AppDeployment.assemble(base, registry))))
const acme = Coord.namespace('acme'), impl = acme.implementationId('counter')
const at = (r: string, p: string, i = impl) => Coord.pod(i, Coord.runtime(r), p)
const EMPTY: Outline = { roots: [], pages: {} }
const create = (app: Application, doc: Outline = EMPTY) => outlineOf(app, registry, doc)
const page = (slots: Outline['pages'][string]['slots']): Outline => ({ roots: ['home'], pages: { home: { slots } } })
const strs = (v: unknown) => JSON.parse(JSON.stringify(v))

describe('apply', () => {
  test('replaces the document, reports per page, and tells listeners before it returns', async () => {
    const p = create(await live(), { roots: ['keep', 'edit', 'drop'], pages: { keep: { slots: {} }, edit: { slots: {} }, drop: { slots: {} } } })
    const heard: unknown[] = []
    p.listen(c => heard.push(c))
    const next: Outline = { roots: ['keep', 'edit', 'add'], pages: { keep: { slots: {} }, edit: { slots: {}, meta: { title: 'E' } }, add: { slots: {} } } }
    expect(p.apply(next)).toEqual(success(undefined))
    expect(heard).toEqual([{ added: ['add'], removed: ['drop'], changed: ['edit'], moved: [], resolved: [] }])
    expect(strs(p.document())).toEqual({ doc: strs(next), version: 1 })
  })
  test('all or nothing: a malformed next changes nothing and tells no one', async () => {
    const p = create(await live()), heard: unknown[] = []
    p.listen(c => heard.push(c))
    const bad = { roots: ['ok', 'home'], pages: { ok: { slots: {} }, home: { slots: { a: { kind: 'pod', pod: 'nope' } } } } } as never
    expect(p.apply(bad)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(strs(p.document())).toEqual({ doc: { roots: [], pages: {} }, version: 0 })
    expect(heard).toEqual([])
  })
  test('a stale base is refused; the current one applies', async () => {
    const p = create(await live())
    ok(p.apply({ roots: ['one'], pages: { one: { slots: {} } } }))
    expect(p.apply({ roots: [], pages: {} }, { base: 0 })).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'the pages changed since' } })
    expect(p.apply({ roots: [], pages: {} }, { base: 1 })).toEqual(success(undefined))
    expect(p.document().version).toBe(2)
  })
  test('a throwing listener is swallowed: the document stays applied and the rest still hear it', async () => {
    const p = create(await live()), heard: unknown[] = []
    p.listen(() => { throw new Error('boom') }); p.listen(c => heard.push(c.added))
    expect(p.apply({ roots: ['one'], pages: { one: { slots: {} } } })).toEqual(success(undefined))
    expect(heard).toEqual([['one']])
    expect(p.document().version).toBe(1)
  })
  test('a slot naming an absent pod is accepted (it resolves missing)', async () => {
    const p = create(await live())
    ok(p.apply(page({ a: { kind: 'pod', pod: at('r', 'nobody') } })))
    expect(p.resolve('home')).toEqual({ a: { kind: 'missing' } })
  })
})

describe('resolve', () => {
  test('pod: found where placed with that implementation; missing elsewhere, or after an undeploy', async () => {
    const app = await live()
    const p = create(app, page({
      a: { kind: 'pod', pod: at('r', 'a') }, wrongRuntime: { kind: 'pod', pod: at('s', 'a') },
      wrongImpl: { kind: 'pod', pod: at('r', 'a', acme.implementationId('broken')) }, v: { kind: 'tool', tool: 'systems' },
    }))
    expect(strs(p.resolve('home'))).toEqual({ a: { kind: 'pod', pods: ['acme/counter@r/a'] }, wrongRuntime: { kind: 'missing' },
      wrongImpl: { kind: 'missing' }, v: { kind: 'tool', tool: 'systems' } })
    ok(await app.apply({ ...base, pods: { b: base.pods.b!, x: base.pods.x! }, runtimes: { ...base.runtimes, r: { pods: ['x'], subscriptions: [] } } }))
    expect(p.resolve('home').a).toEqual({ kind: 'missing' })
    expect(p.resolve('nowhere')).toEqual({})
  })
  test('select: zero, one, or several across two runtimes in a stable order (runtime, then pod)', async () => {
    const p = create(await live(), page({
      none: { kind: 'select', select: { tags: ['nope'] } },
      one: { kind: 'select', select: { implementation: impl, runtime: Coord.runtime('s') } },
      many: { kind: 'select', select: { implements: acme.interfaceId('Counter') } },
    }))
    expect(strs(p.resolve('home'))).toEqual({ none: { kind: 'missing' }, one: { kind: 'pod', pods: ['acme/counter@s/b'] },
      many: { kind: 'pod', pods: ['acme/counter@r/a', 'acme/broken@r/x', 'acme/counter@s/b'] } })
  })
})

describe('open', () => {
  test('starts a lazy pod once, reuses it after, and gives the Fail of one that cannot start', async () => {
    const app = await live()
    const p = create(app, page({ a: { kind: 'pod', pod: at('r', 'a') }, x: { kind: 'pod', pod: at('r', 'x', acme.implementationId('broken')) },
      gone: { kind: 'pod', pod: at('r', 'nobody') }, v: { kind: 'tool', tool: 'systems' } }))
    builds = 0
    const first = await p.open('home')
    expect(strs(first.a)).toEqual({ pod: 'acme/counter@r/a', started: true })
    expect(first.x).toMatchObject({ fail: { reason: expect.stringContaining('cannot build') } })
    expect(first.gone).toEqual({ kind: 'missing' })
    expect(first.v).toEqual({ kind: 'tool', tool: 'systems' })
    expect(app.runtime('s').status('b')).toEqual(success('not started'))
    expect(strs((await p.open('home')).a)).toEqual({ pod: 'acme/counter@r/a', started: false })
    expect(builds).toBe(1)
  })
})

test('the Application applied: the pages whose resolution changed are reported, the rest not', async () => {
  const app = await live()
  const p = create(app, { roots: ['ra', 'sb'], pages: { ra: page({ a: { kind: 'pod', pod: at('r', 'a') } }).pages.home!, sb: page({ b: { kind: 'pod', pod: at('s', 'b') } }).pages.home! } })
  const heard: unknown[] = []
  p.listen(c => heard.push(c))
  ok(await app.apply({ ...base, pods: { b: base.pods.b!, x: base.pods.x! }, runtimes: { ...base.runtimes, r: { pods: ['x'], subscriptions: [] } } }))
  expect(heard).toEqual([{ added: [], removed: [], changed: [], moved: [], resolved: ['ra'] }])
})

test('the pure resolve equals the instance\'s: pod, select (zero, one, several across runtimes), missing and tool', async () => {
  const app = await live()
  const doc = page({ a: { kind: 'pod', pod: at('r', 'a') }, gone: { kind: 'pod', pod: at('r', 'nobody') }, t: { kind: 'tool', tool: 'systems' },
    none: { kind: 'select', select: { tags: ['nope'] } }, one: { kind: 'select', select: { implementation: impl, runtime: Coord.runtime('s') } },
    many: { kind: 'select', select: { implements: acme.interfaceId('Counter') } } })
  const p = create(app, doc), pure = resolve(doc, 'home', app.deployment(), registry)
  expect(strs(pure)).toEqual(strs(p.resolve('home')))
  expect(strs(pure)).toEqual({ a: { kind: 'pod', pods: ['acme/counter@r/a'] }, gone: { kind: 'missing' }, t: { kind: 'tool', tool: 'systems' },
    none: { kind: 'missing' }, one: { kind: 'pod', pods: ['acme/counter@s/b'] }, many: { kind: 'pod', pods: ['acme/counter@r/a', 'acme/broken@r/x', 'acme/counter@s/b'] } })
  expect(resolve(doc, 'nowhere', app.deployment(), registry)).toEqual({})
})

/** A document from `roots` and each page's children (`{ a: ['b'] }`); every page named is made. */
const tree = (roots: string[], children: Record<string, string[]> = {}): Outline => {
  const ids = new Set([...roots, ...Object.keys(children), ...Object.values(children).flat()])
  return { roots, pages: Object.fromEntries([...ids].map(id => [id, { slots: {}, ...(children[id] && { children: children[id] }) }])) }
}
const bare = async () => ok(await Application.create(ok(AppDeployment.assemble({ pods: {}, runtimes: {} }, registry))))

test('a document that is not a tree is refused by apply, naming the page; nothing changes', async () => {
  const p = create(await bare(), tree(['a']))
  expect(p.apply(tree(['a', 'b'], { a: ['b'] }))).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: expect.stringContaining('page b') } })
  expect(strs(p.document())).toEqual({ doc: strs(tree(['a'])), version: 0 })
})

test('the report names pages moved: reorder, reparent, roots only; a parent whose children alone changed is not changed', async () => {
  const p = create(await bare(), tree(['a', 'b', 'c'], { a: ['x', 'y'] }))
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
  const p = create(await bare(), doc)
  const next = tree(['a', 'b'], { b: ['v'] })
  ok(p.apply({ ...next, pages: { ...next.pages, v: doc.pages.v! } }))
  expect(p.resolve('v')).toEqual({ s: { kind: 'tool', tool: 'systems' } })
  expect(await p.open('v')).toEqual({ s: { kind: 'tool', tool: 'systems' } })
})

