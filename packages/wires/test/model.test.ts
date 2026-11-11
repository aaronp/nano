import { expect, test } from 'bun:test'
import { Components, Ops } from '@pritzlaff/nano-core'
import { Debounce, Log, Map, Range } from '@composable/bundle'
import { PlatformOps as P } from '@composable/platform'
import { Type } from 'typebox'
import { buildModel, buildPuzzle, checkConnect } from '../src'
import { panels, setup } from './setup'

const k = (instance: string, op: { ns: string; name: string }) => instance + ' ' + Ops.key(op)
const model = (host: Awaited<ReturnType<typeof setup>>['host']) =>
  buildModel({ snapshot: host.registry.snapshot(), panels, W: 1200, H: 600, platform: 'platform', kinds: { d: 'debounce', m: 'map' }, titles: { debounce: 'Debounce', map: 'Map' } })

test('panels become mirrored chassis with jacks: outs along the top, ins along the bottom', async () => {
  const { host } = await setup()
  const m = model(host)
  expect(m.chassis.map(c => [c.label, c.x, c.instance])).toEqual([['r', 800, 'r'], ['l', 400, 'l'], ['textarea', 0, null]])
  const value = m.P[k('r', Range.ops.value)]!, set = m.P[k('r', Range.ops.set)]!
  expect([value.dir, value.kind, value.y]).toEqual(['out', 'chassis', 56])
  expect([set.dir, set.y]).toEqual(['in', 260])
  expect(Object.values(m.P).filter(p => p.owner === 'l').map(p => [p.label, p.dir])).toEqual([['entries', 'out'], ['debug', 'in'], ['info', 'in'], ['warn', 'in'], ['clear', 'in']])
})

test('the rack holds instances with no panel, but not the registry, views or the platform', async () => {
  const { host } = await setup()
  host.registry.add('watcher', Components.instantiate(Components.create({ ns: 't', name: 'view' }, () => null)), { kind: 'view', name: 'el' })
  const store = Components.create({ ns: 't', name: 'store' }, () => null)
  store.action(Ops.sink('t', 'put', Type.Unknown()), () => {})
  host.registry.add('s', Components.instantiate(store))
  const m = model(host)
  expect(m.rack.map(r => [r.id, r.sub, r.block])).toEqual([['d', 'Debounce', false], ['m', 'Map', false], ['s', 't', true]])
  expect(m.rack[0]!.y).toBe(660)
  expect(m.P[k('s', { ns: 't', name: 'put' })]!.kind).toBe('block')
})

test('subscriptions are wires, grouped into named, coloured routes; view listeners are left out', async () => {
  const { host, call, s1, s2 } = await setup()
  host.registry.add('watcher', Components.instantiate(Components.create({ ns: 't', name: 'view' }, () => null)), { kind: 'view', name: 'el' })
  host.registry.subscribe({ source: 'r', op: Ops.key(Range.ops.value), listener: 'watcher', target: 'x' })
  let m = model(host)
  expect(m.wires).toEqual([
    { id: s1.id, route: s1.id, from: k('r', Range.ops.value), to: k('d', Debounce.ops.enqueue) },
    { id: s2.id, route: s1.id, from: k('d', Debounce.ops.flushed), to: k('l', Log.ops.info) },
  ])
  expect(m.routes).toEqual([{ id: s1.id, name: 'r → l', color: '#7EE787' }])
  await call(P.createComponent, { kind: 'input', name: 'i', system: 'host' })
  await call(P.connect, { system: 'host', source: 'i', op: 'composable.bundle/input/submitted', listener: 'm', target: Ops.key(Map.ops.map) })
  m = model(host)
  expect(m.routes.map(r => [r.name, r.color])).toEqual([['r → l', '#7EE787'], ['i → m', '#F5A524']])
})

test('checkConnect: out into in, fitting, not twice', async () => {
  const { host } = await setup()
  const m = model(host)
  expect(checkConnect(m, k('m', Map.ops.map), k('r', Range.ops.value))).toEqual({ from: k('r', Range.ops.value), to: k('m', Map.ops.map) })
  expect(checkConnect(m, k('r', Range.ops.value), k('l', Log.ops.entries))).toEqual({ error: 'Both jacks emit events — patch an output into an input' })
  expect(checkConnect(m, k('l', Log.ops.entries), k('r', Range.ops.set))).toEqual({ error: "l.entries doesn't fit r.set" })
  expect(checkConnect(m, k('r', Range.ops.value), k('d', Debounce.ops.enqueue))).toEqual({ error: 'Those jacks are already connected' })
})

test('the puzzle lays a route out as a chain, and a fork where one output feeds two inputs', async () => {
  const { host, call } = await setup()
  let pz = buildPuzzle(model(host))
  expect(pz.pieces.map(p => [p.kind, p.label])).toEqual([['port', 'r.value'], ['op', 'd'], ['port', 'l.info']])
  expect(Object.values(pz.descs)).toEqual(['r.value → d → l.info'])
  await call(P.connect, { system: 'host', source: 'd', op: Ops.key(Debounce.ops.flushed), listener: 'm', target: Ops.key(Map.ops.map) })
  pz = buildPuzzle(model(host))
  expect(Object.values(pz.descs)).toEqual(['r.value → d → fork(l.info | m)'])
  expect(pz.pieces.find(p => p.kind === 'fork')!.tabs).toEqual([20, 66])
})

test('an instance named ~view but owned by a widget is in the rack', async () => {
  const { host } = await setup()
  host.registry.add('x~view-9', Components.instantiate(Components.create({ ns: 't', name: 'thing' }, () => null)), { kind: 'widget', name: 'w' })
  expect(model(host).rack.map(r => r.id)).toContain('x~view-9')
})
