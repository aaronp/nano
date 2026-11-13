import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes, type Snapshot } from '@pritzlaff/nano-core'
import { catalog as bundle, Log, Map as MapC } from '@composable/bundle'
import { application, ApplicationOps as P, applyApp, checkApp, RESERVED, unboundOf, type AppCatalog, type NanoApp } from '../src'
import { needsApp } from './fixtures'

const catalog: AppCatalog = { ...bundle, map: { ...bundle.map, code: ['setCode', 'configure'] } }
const setup = () => {
  const host = Runtimes.create(Registries.create('host'))
  host.registry.add('application', Components.instantiate(application(host, catalog)))
  const me = { registry: 'host', instance: 'test' }
  const call = (id: string, op: any, arg: unknown = null) => host.call(me, id, Ops.key(op), arg) as Promise<any>
  const st = { imports: [] as any[], theme: { theme: 'enterprise', mode: 'system' as 'system' | 'light' | 'dark' }, title: 'Nano' }
  const stores = { imports: { list: () => st.imports, set: (xs: any[]) => { st.imports = xs } }, theme: { get: () => st.theme, set: (c: any) => { st.theme = c } }, title: { get: () => st.title, set: (t: string) => { st.title = t } } }
  const deps = { host, stores, catalog, known: { theme: () => true, icon: () => true }, importPackage: async () => ({}) }
  return { host, call, deps }
}
const sys = (instances: any[], subscriptions: any[] = [], id = 'host'): NanoApp => ({ nano: 1, title: 'D', imports: [], workspaces: [], systems: [{ id, instances, subscriptions }] })
const wires = (a: ReturnType<typeof setup>) => a.host.registry.snapshot().subscriptions

test('code is applied only with consent; the instance is created either way', async () => {
  const a = setup()
  const d = sys([{ id: 'm1', kind: 'map', config: { code: 'return 1' } }, { id: 'm2', kind: 'map', config: { code: 'return 2' } }])
  const notes = await applyApp(d, 'replace', { ...a.deps, consentCode: (_s, i) => i === 'm2' })
  expect(notes).toEqual([expect.stringContaining('host/m1: its map code was not applied')])
  expect((await a.call('m1', MapC.ops.code)).value).toBe('return x')
  expect((await a.call('m2', MapC.ops.code)).value).toBe('return 2')
  const b = setup()   // no consentCode at all: no consent
  await applyApp(d, 'replace', b.deps)
  expect((await b.call('m2', MapC.ops.code)).value).toBe('return x')
})

test('a subscription that feeds code needs consent', async () => {
  const a = setup()
  const instances = [{ id: 'm0', kind: 'map' }, { id: 'm1', kind: 'map' }]
  const feed = [{ source: 'm0', op: Ops.key(MapC.ops.code), listener: 'm1', target: Ops.key(MapC.ops.setCode) }]
  const notes = await applyApp(sys(instances, feed), 'replace', a.deps)
  expect(notes.some(n => n.includes('feeds code'))).toBe(true)
  expect(wires(a)).toHaveLength(0)
  expect(await applyApp(sys([], feed), 'merge', { ...a.deps, consentCode: () => true })).toEqual([])
  expect(wires(a)).toHaveLength(1)
})

test('a subscription into a host-driven listener is refused with a note', async () => {
  const a = setup()
  a.host.registry.add('ws-controls-x', Components.instantiate(Log), { kind: 'app', name: 'test' })
  a.host.registry.add('app', Components.instantiate(Log), { kind: 'app', name: 'test' })
  const into = (listener: string, target: string) => ({ source: 'm0', op: Ops.key(MapC.ops.mapped), listener, target })
  const notes = await applyApp(sys([{ id: 'm0', kind: 'map' }], [into('application', Ops.key(P.connect)), into('registry', 'x/y/z'), into('app', Ops.key(Log.ops.info)), into('ws-controls-x', Ops.key(Log.ops.info))]), 'replace', { ...a.deps, consentCode: () => true })
  expect(notes).toHaveLength(4)
  expect(notes.every(n => n.includes('reserved by the host'))).toBe(true)
  expect(wires(a)).toEqual([])
})

test('reserved instance ids are refused with a note', async () => {
  const a = setup()
  const notes = await applyApp(sys([{ id: 'application', kind: 'log' }, { id: 'ex-new', kind: 'log' }, { id: 'ws-controls-y', kind: 'log' }, { id: 'ok', kind: 'log' }]), 'replace', a.deps)
  expect(notes.filter(n => n.includes('reserved'))).toHaveLength(3)
  expect(a.host.registry.get('ex-new')).toBeUndefined()
  expect(a.host.registry.get('ws-controls-y')).toBeUndefined()
  expect(a.host.registry.get('ok')).toBeDefined()
})

test('an unknown theme is refused and a bad icon becomes the folder', async () => {
  const a = setup()
  const d: NanoApp = { ...sys([]), theme: { id: 'nope' }, workspaces: [{ id: '/a', title: 'A', system: 'host', icon: 'bad', layout: null }] }
  const notes = await applyApp(d, 'replace', { ...a.deps, known: { theme: () => false, icon: () => false } })
  expect(notes).toEqual([expect.stringContaining('unknown theme nope')])
  expect((await a.call('application', P.screens)).value[0].icon).toBe('folder')
})

test('merge keeps an existing instance and notes the clash; it applies the document\'s tags', async () => {
  const a = setup()
  await a.call('application', P.createComponent, { kind: 'map', name: 'm1', system: 'host' })
  await a.call('m1', MapC.ops.setCode, 'return 7')
  const d = { ...sys([{ id: 'm1', kind: 'map', config: { code: 'return 1' } }, { id: 'm2', kind: 'log' }]), tags: { 'instance:host/m1': ['mine'], 'instance:host/m2': ['new'] } }
  const notes = await applyApp(d, 'merge', { ...a.deps, consentCode: () => true })
  expect(notes).toEqual([expect.stringContaining('host/m1: already exists, skipped')])
  expect((await a.call('m1', MapC.ops.code)).value).toBe('return 7')
  expect(a.host.registry.get('m2')).toBeDefined()
  expect((await a.call('application', P.allTags)).value).toEqual({ 'instance:host/m1': ['mine'], 'instance:host/m2': ['new'] })
})

const needsDoc = (systems: NanoApp['systems']): NanoApp => ({ nano: 1, title: 'D', imports: [], workspaces: [], systems })

test('needs: a pin to an instance later in the document, in another system, binds, and wins over auto-bind', async () => {
  const a = needsApp()
  // db1 comes first in host, so auto-bind takes it for svc before the pin to storage/db2 is applied
  const doc = needsDoc([
    { id: 'host', instances: [{ id: 'db1', kind: 'db' }, { id: 'svc', kind: 'service', needs: { db: { implements: 't/db', layer: 'storage', at: 'db2' } } }], subscriptions: [] },
    { id: 'storage', instances: [{ id: 'db2', kind: 'db' }], subscriptions: [] },
  ])
  expect(checkApp(doc)).toEqual(doc)
  expect(await applyApp(doc, 'replace', a.deps)).toEqual([])
  expect(a.host.registry.binding('svc', 'db')).toEqual({ registry: 'storage', instance: 'db2' })
})

test('needs: an unresolvable need is a note and the instance stays disabled; loading makes nothing', async () => {
  const a = needsApp()
  const doc = needsDoc([{ id: 'app', instances: [{ id: 'form', kind: 'form', needs: { bff: { implements: 't/bff' } } }], subscriptions: [] }])
  expect(await applyApp(doc, 'replace', a.deps)).toEqual(['app/form needs bff: nothing matches'])
  const app = ((await a.call(P.systems)) as Snapshot[]).find(s => s.id === 'app')!
  expect(unboundOf(app)).toEqual([{ instance: 'form', need: 'bff' }])
  expect(app.instances.map(i => i.id).filter(id => !RESERVED(id))).toEqual(['form'])
})

test('needs: an unknown need or instance is a note, never a throw, and the rest loads', async () => {
  const a = needsApp()
  const doc = needsDoc([{ id: 'host', instances: [
    { id: 'db1', kind: 'db' },
    { id: 'svc', kind: 'service', needs: { nope: { implements: 't/db' }, db: { implements: 't/db', at: 'ghost' } } },
    { id: 'svc2', kind: 'service', needs: { db: { implements: 't/db', layer: 'nowhere' } } },
    { id: 'gone', kind: 'unknown-kind', needs: { db: { implements: 't/db' } } },
  ], subscriptions: [] }])
  expect(await applyApp(doc, 'replace', a.deps)).toEqual([
    'host/gone: no component kind unknown-kind, skipped',
    'host/svc needs nope: svc has no need nope',
    "host/svc needs db: host/ghost doesn't fit",
    'host/svc2 needs db: no system nowhere',
  ])
  expect(a.host.registry.snapshot().instances.map(i => i.id)).toEqual(expect.arrayContaining(['db1', 'svc', 'svc2']))
  // auto-bind took db1 meanwhile: a pin that fails leaves the instance disabled, not bound to something else
  expect(a.host.registry.binding('svc', 'db')).toBeUndefined()
  expect(a.host.registry.binding('svc2', 'db')).toBeUndefined()
})

test('needs: a saved selector with a tag nothing has leaves the need unbound, though auto-bind matched more loosely', async () => {
  const a = needsApp()
  const doc = needsDoc([{ id: 'host', instances: [{ id: 'db1', kind: 'db' }, { id: 'svc', kind: 'service', needs: { db: { implements: 't/db', tags: ['fast'] } } }], subscriptions: [] }])
  expect(await applyApp(doc, 'replace', a.deps)).toEqual(['host/svc needs db: nothing matches'])
  expect(a.host.registry.binding('svc', 'db')).toBeUndefined()
})

test('needs: set-selector takes the same limits as the document', async () => {
  const a = needsApp()
  await a.make('service', 'svc')
  const r = await a.host.call({ registry: 'host', instance: 'test' }, 'application', Ops.key(P.setSelector), { ref: 'instance:host/svc', need: 'db', selector: { implements: 'x'.repeat(201) } }) as any
  expect(r.error).toBeDefined()
})

test('needs: checkApp validates needs, and a document without them still validates', () => {
  const doc = (needs?: unknown) => needsDoc([{ id: 'host', instances: [{ id: 'svc', kind: 'service', ...(needs !== undefined && { needs }) } as any], subscriptions: [] }])
  expect(checkApp(doc())).toEqual(doc())
  expect(typeof checkApp(doc({ db: { implements: 't/db', tags: ['a'], layer: 'storage', at: 'db1' } }))).toBe('object')
  expect(typeof checkApp(doc({ Db: { implements: 't/db' } }))).toBe('string')
  expect(typeof checkApp(doc({ db: { implements: 'x'.repeat(201) } }))).toBe('string')
  expect(typeof checkApp(doc({ db: { implements: 't/db', at: 'a/b' } }))).toBe('string')
  expect(typeof checkApp(doc({ db: { implements: 't/db', tags: Array.from({ length: 21 }, (_, i) => `t${i}`) } }))).toBe('string')
  expect(typeof checkApp(doc(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`n${i}`, { implements: 't/db' }]))))).toBe('string')
})
