import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes } from '@pritzlaff/nano-core'
import { catalog as bundle, Log, Map as MapC } from '@composable/bundle'
import { application, ApplicationOps as P, applyApp, type AppCatalog, type NanoApp } from '../src'

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
