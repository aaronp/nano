import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes } from '@pritzlaff/nano-core'
import { catalog } from '@composable/bundle'
import { application, ApplicationOps as P, applyApp, snapshotApp, checkApp, type HostStores, type NanoApp } from '../src'

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
