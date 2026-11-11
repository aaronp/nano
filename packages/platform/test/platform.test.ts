import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes, type Op, type Snapshot } from '@pritzlaff/nano-core'
import { catalog, Log, Range } from '@composable/bundle'
import type { Catalog } from '@pritzlaff/nano-elements'
import { platform, PlatformOps as P, runtimeOf } from '../src'

const tick = () => new Promise(r => setTimeout(r, 0))
const setup = () => {
  const host = Runtimes.create(Registries.create('host'))
  host.registry.add('platform', Components.instantiate(platform(host, catalog)))
  const call = (op: Op, arg: unknown = null) => host.call({ registry: 'host', instance: 'test' }, 'platform', Ops.key(op), arg) as Promise<any>
  const events: unknown[] = []
  const spy = Components.create({ ns: 't', name: 'spy' }, () => events)
  spy.action(Ops.sink('t', 'take', P.stateChanged.output!), (e, x) => { e.push(x) })
  host.registry.add('spy', Components.instantiate(spy))
  host.registry.subscribe({ source: 'platform', op: Ops.key(P.stateChanged), listener: 'spy', target: 't/take' })
  return { host, call, events }
}
const ids = (s: Snapshot) => s.instances.map(i => i.id).filter(i => i !== 'registry')

test('create a system and a component in it', async () => {
  const { call } = setup()
  expect((await call(P.createSystem, 'lab')).value).toBeUndefined()
  expect('error' in await call(P.createSystem, 'lab')).toBe(true)
  await call(P.createComponent, { kind: 'range', name: 'r', system: 'lab' })
  expect('error' in await call(P.createComponent, { kind: 'nope', name: 'x', system: 'lab' })).toBe(true)
  const systems: Snapshot[] = (await call(P.systems)).value
  expect(systems.map(s => s.id)).toEqual(['host', 'lab'])
  expect(ids(systems[1]!)).toEqual(['r'])
  expect((await call(P.catalog)).value).toEqual(Object.keys(catalog))
})

test('add-to-system puts the same instance in both systems', async () => {
  const { call } = setup()
  await call(P.createSystem, 'lab')
  await call(P.createComponent, { kind: 'range', name: 'r', system: 'host' })
  await call(P.addToSystem, { instance: 'r', from: 'host', to: 'lab' })
  const systems: Snapshot[] = (await call(P.systems)).value
  expect(ids(systems[1]!)).toEqual(['r'])
  await call(P.removeFromSystem, { instance: 'r', system: 'host' })
  expect(ids((await call(P.systems)).value[0])).not.toContain('r')
  expect('error' in await call(P.removeFromSystem, { instance: 'platform', system: 'host' })).toBe(true)
})

test('connect wires fitting actions in one system, and refuses the rest', async () => {
  const { host, call } = setup()
  await call(P.createComponent, { kind: 'range', name: 'r', system: 'host' })
  await call(P.createComponent, { kind: 'log', name: 'l', system: 'host' })
  await call(P.createSystem, 'lab')
  await call(P.createComponent, { kind: 'log', name: 'far', system: 'lab' })
  const sub = await call(P.connect, { system: 'host', source: 'r', op: Ops.key(Range.ops.value), listener: 'l', target: Ops.key(Log.ops.info) })
  expect(sub.value.id).toBeString()
  expect('error' in await call(P.connect, { system: 'host', source: 'l', op: Ops.key(Log.ops.entries), listener: 'r', target: Ops.key(Range.ops.set) })).toBe(true)   // entries are not a number
  expect('error' in await call(P.connect, { system: 'host', source: 'r', op: Ops.key(Range.ops.value), listener: 'far', target: Ops.key(Log.ops.info) })).toBe(true)
  await host.call({ registry: 'host', instance: 'test' }, 'r', Ops.key(Range.ops.set), 12); await tick()
  expect((host.registry.get('l')!.value as any).entries.map((e: any) => e.value)).toEqual([12])
  await call(P.disconnect, { system: 'host', id: sub.value.id })
  expect(host.registry.snapshot().subscriptions.some(s => s.listener === 'l')).toBe(false)
})

test('state-changed fires for every system; select publishes the selection', async () => {
  const { call, events } = setup()
  await call(P.createSystem, 'lab')
  await call(P.createComponent, { kind: 'log', name: 'l', system: 'lab' }); await tick()
  expect(events.some((e: any) => e.system === 'lab' && e.delta.type === 'instance-added')).toBe(true)
  const sel = { system: 'host', instance: 'platform', op: Ops.key(P.select) }
  await call(P.select, sel)
  expect((await call(P.selected)).value).toEqual(sel)
})

test('a burst of changes publishes the systems once', async () => {
  const { host } = setup()
  const seen: unknown[] = []
  const counter = Components.create({ ns: 't', name: 'count' }, () => seen)
  counter.action(Ops.sink('t', 'see', P.systems.output!), (s, x) => { s.push(x) })
  host.registry.add('counter', Components.instantiate(counter))
  host.registry.subscribe({ source: 'platform', op: Ops.key(P.systems), listener: 'counter', target: 't/see' })
  await tick(); seen.length = 0
  host.registry.add('a', Components.instantiate(Log))   // three deltas in a row, as attaching an element makes:
  host.registry.subscribe({ source: 'a', op: 'x', listener: 'a', target: 'y' })
  host.registry.subscribe({ source: 'a', op: 'z', listener: 'a', target: 'y' })
  await tick()
  expect(seen).toHaveLength(1)
})

test('removing a component from a system removes its connections both ways', async () => {
  const { host, call } = setup()
  await call(P.createComponent, { kind: 'range', name: 'r', system: 'host' })
  await call(P.createComponent, { kind: 'log', name: 'l', system: 'host' })
  await call(P.connect, { system: 'host', source: 'r', op: Ops.key(Range.ops.value), listener: 'l', target: Ops.key(Log.ops.info) })
  await call(P.removeFromSystem, { instance: 'r', system: 'host' })
  expect(host.registry.snapshot().subscriptions.filter(s => s.source === 'r')).toEqual([])
})

test('runtimeOf finds a system\'s runtime through the platform', async () => {
  const { host, call } = setup()
  await call(P.createSystem, 'lab')
  expect(runtimeOf(host.registry, 'lab')!.registry.id).toBe('lab')
  expect(runtimeOf(host.registry, 'host')).toBe(host)
  expect(runtimeOf(host.registry, 'nope')).toBeUndefined()
})

test('components the platform creates or adds are owned by the platform', async () => {
  const { host, call } = setup()
  await call(P.createSystem, 'lab')
  await call(P.createComponent, { kind: 'range', name: 'r', system: 'host' })
  await call(P.addToSystem, { instance: 'r', from: 'host', to: 'lab' })
  const owner = { kind: 'platform', name: 'platform' }
  expect(host.registry.snapshot().instances.find(i => i.id === 'r')!.owner).toEqual(owner)
  expect(runtimeOf(host.registry, 'lab')!.registry.snapshot().instances.find(i => i.id === 'r')!.owner).toEqual(owner)
})

const idOf = (c: { id: { ns: string; name: string } }) => `${c.id.ns}/${c.id.name}`

test('kinds lists each catalog kind with its component id, title and tag', async () => {
  const { call } = setup()
  const kinds = (await call(P.kinds)).value as any[]
  expect(kinds.map(k => k.kind)).toEqual(Object.keys(catalog))
  const r = catalog.range!
  expect(kinds.find(k => k.kind === 'range')).toEqual({ kind: 'range', component: idOf(r.component), title: r.title, ...(r.tag && { tag: r.tag }), description: r.component.description })
})

test('after catalog-changed, a kind added to the catalog object is published in kinds', async () => {
  const host = Runtimes.create(Registries.create('host')), mine: Catalog = { ...catalog }
  host.registry.add('platform', Components.instantiate(platform(host, mine)))
  const heard: any[][] = []
  const spy = Components.create({ ns: 't', name: 'spy' }, () => heard)
  spy.action(Ops.sink('t', 'take', P.kinds.output!), (h, x) => { h.push(x as any[]) })
  host.registry.add('spy', Components.instantiate(spy))
  host.registry.subscribe({ source: 'platform', op: Ops.key(P.kinds), listener: 'spy', target: 't/take' })
  mine.extra = { component: Components.create({ ns: 't', name: 'extra' }, () => ({})), title: 'Extra' }
  await host.call({ registry: 'host', instance: 'test' }, 'platform', Ops.key(P.catalogChanged), null); await tick()
  expect(heard.at(-1)!.find(k => k.kind === 'extra')).toEqual({ kind: 'extra', component: 't/extra', title: 'Extra' })
})

test('createComponent with a mode goes through deploy; without deploy, unchanged', async () => {
  const seen: unknown[][] = []
  const host = Runtimes.create(Registries.create('host'))
  host.registry.add('platform', Components.instantiate(platform(host, catalog, {
    deploy: (rt, id, kind, mode, owner, outward) => { seen.push([rt.registry.id, id, kind, mode, owner.kind, outward]); return { value: undefined } },
  })))
  const call = (op: Op, arg: unknown) => host.call({ registry: 'host', instance: 't' }, 'platform', Ops.key(op), arg) as Promise<any>
  await call(P.createComponent, { kind: 'range', name: 'r', system: 'host', mode: 'sandbox', allow: ['a/*'], deny: ['b/*'] })
  await call(P.createComponent, { kind: 'range', name: 'q', system: 'host' })
  expect(seen).toEqual([['host', 'r', 'range', 'sandbox', 'platform', { allow: ['a/*'], deny: ['b/*'] }], ['host', 'q', 'range', undefined, 'platform', undefined]])
  expect('error' in await call(P.createComponent, { kind: 'nope', name: 'x', system: 'host' })).toBe(true)
  const plain = setup()   // no deploy: instantiates the catalog's component, mode ignored
  await plain.call(P.createComponent, { kind: 'range', name: 'p', system: 'host', mode: 'sandbox' })
  expect(plain.host.registry.get('p')).toBeDefined()
})

test('kinds carry modes', async () => {
  const host = Runtimes.create(Registries.create('host'))
  host.registry.add('platform', Components.instantiate(platform(host, { range: { ...catalog.range!, modes: ['host', 'sandbox'] }, log: catalog.log! })))
  const kinds = (await host.call({ registry: 'host', instance: 't' }, 'platform', Ops.key(P.kinds), null) as any).value
  expect(kinds.find((k: any) => k.kind === 'range').modes).toEqual(['host', 'sandbox'])
  expect(kinds.find((k: any) => k.kind === 'log').modes).toBeUndefined()
})

test('createComponent without a mode uses the kind\'s first allowed mode', async () => {
  const seen: unknown[] = []
  const host = Runtimes.create(Registries.create('host'))
  host.registry.add('platform', Components.instantiate(platform(host, { range: { ...catalog.range!, modes: ['isolated-sandbox', 'host'] }, log: catalog.log! }, {
    deploy: (_rt, id, _k, mode) => { seen.push([id, mode]); return { value: undefined } },
  })))
  const call = (arg: unknown) => host.call({ registry: 'host', instance: 't' }, 'platform', Ops.key(P.createComponent), arg)
  await call({ kind: 'range', name: 'a', system: 'host' }); await call({ kind: 'range', name: 'b', system: 'host', mode: 'host' }); await call({ kind: 'log', name: 'c', system: 'host' })
  expect(seen).toEqual([['a', 'isolated-sandbox'], ['b', 'host'], ['c', undefined]])
})

test('add-to-system carries the instance\'s labels', async () => {
  const { host, call } = setup()
  await call(P.createSystem, 'lab')
  await call(P.createComponent, { kind: 'range', name: 'r', system: 'host' })
  host.registry.label('r', { 'nano/deploy': 'sandbox', 'nano/guarded': 'true' })
  await call(P.addToSystem, { instance: 'r', from: 'host', to: 'lab' })
  expect(runtimeOf(host.registry, 'lab')!.registry.labels('r')).toEqual({ 'nano/deploy': 'sandbox', 'nano/guarded': 'true' })
})
