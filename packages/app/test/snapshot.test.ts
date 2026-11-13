import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes } from '@pritzlaff/nano-core'
import { catalog } from '@composable/bundle'
import { application, ApplicationOps as P, applyApp, snapshotApp, checkApp, type HostStores, type NanoApp } from '../src'
import { needsApp, tick } from './fixtures'

const setup = () => {
  const host = Runtimes.create(Registries.create('host'))
  host.registry.add('application', Components.instantiate(application(host, catalog)))
  const call = (op: any, arg: unknown = null) => host.call({ registry: 'host', instance: 'test' }, 'application', Ops.key(op), arg) as Promise<any>
  const st = { imports: [] as any[], theme: { theme: 'enterprise', mode: 'system' as 'system' | 'light' | 'dark' }, title: 'Nano' }
  const stores: HostStores = { imports: { list: () => st.imports, set: xs => { st.imports = xs } }, theme: { get: () => st.theme, set: c => { st.theme = c } }, title: { get: () => st.title, set: t => { st.title = t } } }
  const deps = { host, stores, catalog, known: { theme: () => true, icon: () => true }, importPackage: async () => ({}) }
  return { host, call, stores, deps }
}
const empty: NanoApp = { nano: 1, title: 'Doc', imports: [], systems: [], workspaces: [] }

test('a snapshot saves tags and the main workspace', async () => {
  const { host, call, stores } = setup()
  await call(P.createComponent, { kind: 'range', name: 'r1', system: 'host' })
  await call(P.setScreen, { id: '/workspace', title: 'Main', system: 'host', layout: { root: 1 } })
  await call(P.tag, { ref: 'instance:host/r1', tag: 'billing' })
  await call(P.tag, { ref: 'screen:/workspace', tag: 'home' })
  await call(P.tag, { ref: 'instance:host/application', tag: 'built-in' })   // not written: its instance isn't
  const doc = await snapshotApp(host, stores)
  expect(doc.workspaces).toEqual([{ id: '/workspace', title: 'Main', system: 'host', layout: { root: 1 } }])
  expect(doc.tags).toEqual({ 'instance:host/r1': ['billing'], 'screen:/workspace': ['home'] })
  expect(typeof checkApp(doc)).toBe('object')
})

test('apply restores tags after instances and screens exist', async () => {
  const a = setup()
  const doc: NanoApp = { ...empty, systems: [{ id: 'lab', instances: [{ id: 'r1', kind: 'range', mode: 'host' }], subscriptions: [] }],
    workspaces: [{ id: '/workspace', title: 'Main', system: 'host', layout: { root: 3 } }, { id: '/lab', title: 'Lab', system: 'lab', layout: null }],
    tags: { 'instance:lab/r1': ['billing', 'x'], 'screen:/lab': ['y'], 'system:lab': ['z'] } }
  expect(await applyApp(doc, 'replace', a.deps)).toEqual([])
  expect((await a.call(P.tagged, 'billing')).value).toEqual(['instance:lab/r1'])
  expect((await a.call(P.allTags)).value).toEqual({ 'instance:lab/r1': ['billing', 'x'], 'screen:/lab': ['y'], 'system:lab': ['z'] })
  expect((await a.call(P.screens)).value.map((s: any) => [s.id, s.layout])).toEqual([['/workspace', { root: 3 }], ['/lab', null]])
  expect(await snapshotApp(a.host, a.stores)).toMatchObject({ tags: doc.tags })
})

test('a tag on a malformed or missing ref is dropped with a note', async () => {
  const a = setup()
  const notes = await applyApp({ ...empty, tags: { 'nonsense': ['a'], 'instance:host/ghost': ['b'] } }, 'replace', a.deps)
  expect(notes).toHaveLength(2)
  expect(notes[0]).toContain('nonsense'); expect(notes[1]).toContain('instance:host/ghost')
  expect((await a.call(P.allTags)).value).toEqual({})
})

test('a document without tags or a main workspace still opens, and leaves Main as it is', async () => {
  const a = setup()
  await a.call(P.setScreen, { id: '/workspace', title: 'Main', system: 'host', layout: { root: 9 } })
  expect(await applyApp(empty, 'replace', a.deps)).toEqual([])
  expect((await a.call(P.screens)).value.map((s: any) => [s.id, s.layout])).toEqual([['/workspace', { root: 9 }]])
})

test("Main's system stays the host, whatever the document says", async () => {
  const a = setup()
  expect(await applyApp({ ...empty, workspaces: [{ id: '/workspace', title: 'Main', system: 'ghost', layout: { root: 4 } }] }, 'replace', a.deps)).toEqual([])
  expect((await a.call(P.screens)).value.map((s: any) => [s.id, s.system, s.layout])).toEqual([['/workspace', 'host', { root: 4 }]])
  expect((await a.call(P.systems)).value.map((s: any) => s.id)).not.toContain('ghost')
})

test('checkApp refuses 21 tags on one ref', () => {
  const tags = (n: number) => ({ ...empty, tags: { 'instance:host/r1': Array.from({ length: n }, (_, i) => `t${i}`) } })
  expect(typeof checkApp(tags(20))).toBe('object')
  expect(typeof checkApp(tags(21))).toBe('string')
  expect(typeof checkApp({ ...empty, tags: { 'screen:/a': [' x '] } })).toBe('string')
  expect(typeof checkApp({ ...empty, tags: { ['screen:/' + 'a'.repeat(300)]: ['x'] } })).toBe('string')
})

test('needs: a snapshot writes each need as a pin, and loading it gives the same bindings', async () => {
  const a = needsApp()
  await a.call(P.createSystem, 'storage')
  await a.make('db', 'db1', 'storage'); await a.make('service', 'svc'); await a.make('form', 'form'); await tick()
  await a.call(P.tag, { ref: 'instance:storage/db1', tag: 'fast' })
  await a.call(P.bindNeed, { ref: 'instance:host/svc', need: 'db', to: 'instance:storage/db1' })
  const doc = await snapshotApp(a.host, a.stores)
  const host = doc.systems.find(s => s.id === 'host')!
  expect(host.instances.find(i => i.id === 'svc')!.needs).toEqual({ db: { implements: 't/db', tags: ['fast'], layer: 'storage', at: 'db1' } })
  expect(host.instances.find(i => i.id === 'form')!.needs).toEqual({ bff: { implements: 't/bff' } })   // unbound: its stored selector
  expect(doc.systems.find(s => s.id === 'storage')!.instances[0]!.needs).toBeUndefined()
  expect(typeof checkApp(doc)).toBe('object')
  // a pin carries the target's tags now, not those it had when bound; none, no tags
  await a.call(P.untag, { ref: 'instance:storage/db1', tag: 'fast' }); await a.call(P.tag, { ref: 'instance:storage/db1', tag: 'slow' })
  expect((await snapshotApp(a.host, a.stores)).systems.find(s => s.id === 'host')!.instances.find(i => i.id === 'svc')!.needs!.db!.tags).toEqual(['slow'])
  await a.call(P.untag, { ref: 'instance:storage/db1', tag: 'slow' })
  expect((await snapshotApp(a.host, a.stores)).systems.find(s => s.id === 'host')!.instances.find(i => i.id === 'svc')!.needs!.db).toEqual({ implements: 't/db', layer: 'storage', at: 'db1' })
  await a.call(P.tag, { ref: 'instance:storage/db1', tag: 'fast' })
  const b = needsApp()
  expect(await applyApp(doc, 'replace', b.deps)).toEqual(['host/form needs bff: nothing matches'])
  expect(await b.bindings()).toEqual(await a.bindings())
})

test('needs: a pin survives a wrap, a second db in the document keeps the original binding', async () => {
  const a = needsApp()
  await a.make('db', 'db1'); await a.make('service', 'svc'); await tick()
  const doc = await snapshotApp(a.host, a.stores)
  doc.systems[0]!.instances.unshift({ id: 'db2', kind: 'db' })   // first: without the pin, two fit and svc stays unbound
  const b = needsApp()
  expect(await applyApp(doc, 'replace', b.deps)).toEqual([])
  expect(b.host.registry.binding('svc', 'db')).toEqual({ registry: 'host', instance: 'db1' })
})
