// The application and needs: list, select, bind, auto-bind on create, and calls between systems.
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Components, define, iface, Ops, type Op, type Snapshot } from '@pritzlaff/nano-core'
import { ApplicationOps as P } from '../src/application'
import { createApplication } from '../src/create'
import { unboundOf } from '../src/infrastructure'

const tick = () => new Promise(r => setTimeout(r, 0))
const Db = iface('t/db', { save: { in: Type.String(), out: Type.String() } })
const MemoryDb = define('t/memory-db', Db, {}, () => { const got: string[] = []; return { save: x => { got.push(x); return `saved ${x}` } } })
const Api = iface('t/api', { put: { in: Type.String(), out: Type.String() } })
const Service = define('t/service', Api, { db: Db }, ({ db }) => ({ put: x => db.save(x) }))

const setup = () => {
  const { host } = createApplication({ catalogs: [{ db: { component: MemoryDb }, service: { component: Service } }] })
  const ask = async (op: Op, arg: unknown = null) => host.call({ registry: 'host', instance: 'test' }, 'application', Ops.key(op), arg) as Promise<any>
  const call = async (op: Op, arg: unknown = null) => { const r = await ask(op, arg); if ('error' in r) throw new Error(r.error); return r.value }
  const make = (kind: string, name: string, system = 'host') => call(P.createComponent, { kind, name, system })
  const snap = async (id = 'host'): Promise<Snapshot> => (await call(P.systems)).find((s: Snapshot) => s.id === id)
  return { host, ask, call, make, snap }
}

test('kinds carry what they implement and need', async () => {
  const { call } = setup()
  const kinds = await call(P.kinds)
  expect(kinds.find((k: any) => k.kind === 'db')).toMatchObject({ implements: ['t/db'] })
  expect(kinds.find((k: any) => k.kind === 'service')).toMatchObject({ implements: ['t/api'], needs: { db: 't/db' } })
})

test('a created consumer auto-binds to the one existing provider', async () => {
  const { call, make, host } = setup()
  await make('db', 'db1'); await make('service', 'svc'); await tick()
  expect(host.registry.binding('svc', 'db')).toEqual({ registry: 'host', instance: 'db1' })
  expect(await call(P.needsOf, 'instance:host/svc')).toEqual([{ need: 'db', implements: 't/db', selector: { implements: 't/db' }, binding: 'instance:host/db1' }])
})

test('with two providers it stays unbound, and unboundOf lists it', async () => {
  const { make, snap } = setup()
  await make('db', 'db1'); await make('db', 'db2'); await make('service', 'svc'); await tick()
  expect(unboundOf(await snap())).toEqual([{ instance: 'svc', need: 'db' }])
})

test('auto-bind never makes an instance', async () => {
  const { make, snap } = setup()
  await make('service', 'svc'); await tick()
  expect((await snap()).instances.map(i => i.id)).not.toContain('db')
  expect(unboundOf(await snap())).toEqual([{ instance: 'svc', need: 'db' }])
})

test('setSelector with at rebinds, and returns the resolution', async () => {
  const { call, make, host } = setup()
  await make('db', 'db1'); await make('service', 'svc'); await tick()
  await make('db', 'db2')
  expect(await call(P.setSelector, { ref: 'instance:host/svc', need: 'db', selector: { implements: 't/db', at: 'db2' } })).toEqual({ bound: { registry: 'host', instance: 'db2' } })
  expect(host.registry.binding('svc', 'db')).toEqual({ registry: 'host', instance: 'db2' })
  expect((await call(P.needsOf, 'instance:host/svc'))[0].selector).toEqual({ implements: 't/db', at: 'db2' })
  const r = await call(P.setSelector, { ref: 'instance:host/svc', need: 'db', selector: { implements: 't/db', at: 'svc' } })
  expect(r.choose.candidates).toEqual([{ registry: 'host', instance: 'db1' }, { registry: 'host', instance: 'db2' }])
  expect(r.choose.kinds).toEqual(['db'])
})

test('bindNeed stores a pinned selector carrying the target\'s tags', async () => {
  const { call, make, host } = setup()
  await call(P.createSystem, 'storage')
  await make('db', 'db1', 'storage'); await make('service', 'svc'); await tick()
  await call(P.tag, { ref: 'instance:storage/db1', tag: 'fast' })
  await call(P.bindNeed, { ref: 'instance:host/svc', need: 'db', to: 'instance:storage/db1' })
  expect(host.registry.binding('svc', 'db')).toEqual({ registry: 'storage', instance: 'db1' })
  expect(await call(P.needsOf, 'instance:host/svc')).toEqual([{ need: 'db', implements: 't/db',
    selector: { implements: 't/db', layer: 'storage', at: 'db1', tags: ['fast'] }, binding: 'instance:storage/db1' }])
})

test('unbindNeed makes the instance disabled', async () => {
  const { call, make, snap } = setup()
  await make('db', 'db1'); await make('service', 'svc'); await tick()
  expect(unboundOf(await snap())).toEqual([])
  await call(P.unbindNeed, { ref: 'instance:host/svc', need: 'db' })
  expect(unboundOf(await snap())).toEqual([{ instance: 'svc', need: 'db' }])
  expect((await call(P.needsOf, 'instance:host/svc'))[0].binding).toBeUndefined()
})

test('an unknown need is an error', async () => {
  const { ask, make } = setup()
  await make('service', 'svc')
  expect((await ask(P.bindNeed, { ref: 'instance:host/svc', need: 'nope', to: 'instance:host/svc' })).error).toBe('svc has no need nope')
  expect((await ask(P.setSelector, { ref: 'instance:host/svc', need: 'nope', selector: { implements: 't/db' } })).error).toBe('svc has no need nope')
  expect((await ask(P.unbindNeed, { ref: 'instance:host/svc', need: 'nope' })).error).toBe('svc has no need nope')
})

test('a removed instance loses its selectors', async () => {
  const { call, make } = setup()
  await make('db', 'db1'); await make('service', 'svc')
  await call(P.setSelector, { ref: 'instance:host/svc', need: 'db', selector: { implements: 't/db', tags: ['x'] } })
  await call(P.removeFromSystem, { instance: 'svc', system: 'host' })
  await make('service', 'svc')
  expect((await call(P.needsOf, 'instance:host/svc'))[0].selector).toEqual({ implements: 't/db' })
})

test('cross-system calls work after createSystem, both ways', async () => {
  const { host, call, make } = setup()
  await call(P.createSystem, 'storage'); await call(P.createSystem, 'lab')
  await make('db', 'db1', 'storage'); await make('service', 'svc'); await tick()
  expect(await call(P.setSelector, { ref: 'instance:host/svc', need: 'db', selector: { implements: 't/db', layer: 'storage' } })).toEqual({ bound: { registry: 'storage', instance: 'db1' } })
  expect(await host.call({ registry: 'host', instance: 'test' }, 'svc', Ops.key(Api.ops.put), 'a')).toEqual({ value: 'saved a' })
  await make('service', 'far', 'lab'); await tick()
  await call(P.bindNeed, { ref: 'instance:lab/far', need: 'db', to: 'instance:storage/db1' })
  const lab = (host.registry.get('application')!.value as any).systems.get('lab')
  expect(await lab.call({ registry: 'lab', instance: 'test' }, 'far', Ops.key(Api.ops.put), 'b')).toEqual({ value: 'saved b' })
})

test('the systems source republishes on a binding delta', async () => {
  const { host, call, make } = setup()
  const got: Snapshot[][] = []
  const spy = Components.create({ ns: 't', name: 'spy' }, () => got)
  spy.action(Ops.sink('t', 'take', P.systems.output!), (g, x) => { g.push(x as Snapshot[]) })
  host.registry.add('spy', Components.instantiate(spy))
  host.registry.subscribe({ source: 'application', op: Ops.key(P.systems), listener: 'spy', target: 't/take' })
  await make('db', 'db1'); await make('db', 'db2'); await make('service', 'svc'); await tick()
  got.length = 0
  await call(P.bindNeed, { ref: 'instance:host/svc', need: 'db', to: 'instance:host/db2' }); await tick()
  expect(got.at(-1)![0]!.bindings).toEqual([{ instance: 'svc', need: 'db', to: { registry: 'host', instance: 'db2' } }])
})

test("bindNeed refuses to bind an instance to itself", async () => {
  const { ask, make, host } = setup()
  await make('service', 'svc')
  expect((await ask(P.bindNeed, { ref: 'instance:host/svc', need: 'db', to: 'instance:host/svc' })).error).toBe("svc can't depend on itself")
  expect(host.registry.binding('svc', 'db')).toBeUndefined()
})
