import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes, type Op } from '@pritzlaff/nano-core'
import { catalog } from '@composable/bundle'
import { application, ApplicationOps as P } from '../src/application'

const setup = (placementsOf: (l: any) => any[] = l => l.p ?? []) => {
  const host = Runtimes.create(Registries.create('host'))
  host.registry.add('application', Components.instantiate(application(host, catalog, { placementsOf })))
  const call = (op: Op, arg: unknown = null) => host.call({ registry: 'host', instance: 'test' }, 'application', Ops.key(op), arg) as Promise<any>
  const events: any[] = []
  const spy = Components.create({ ns: 't', name: 'spy' }, () => events)
  spy.action(Ops.sink('t', 'take', P.changed.output!), (e, x) => { e.push(x) })
  host.registry.add('spy', Components.instantiate(spy))
  host.registry.subscribe({ source: 'application', op: Ops.key(P.changed), listener: 'spy', target: 't/take' })
  return { call, events }
}
const lab = (p: unknown[] = [], id = '/lab') => ({ id, title: 'Lab', system: 'host', layout: { p } })

test('setScreen stores a screen and works out its placements', async () => {
  const { call } = setup()
  await call(P.setScreen, lab([{ panel: 'a', instance: 'r1' }]))
  expect((await call(P.screens)).value.map((s: any) => s.id)).toEqual(['/lab'])
  expect((await call(P.placements, { screen: '/lab' })).value).toEqual([{ screen: '/lab', panel: 'a', instance: 'r1' }])
})

test('placements carry box and tab from placementsOf', async () => {
  const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, tab = { group: 'g', active: true }
  const { call } = setup(() => [{ panel: 'a', instance: 'r1', box, tab }])
  await call(P.setScreen, lab())
  expect((await call(P.placements, { screen: '/lab' })).value).toEqual([{ screen: '/lab', panel: 'a', instance: 'r1', box, tab }])
})

test('a new layout replaces the placements', async () => {
  const { call } = setup()
  await call(P.setScreen, lab([{ panel: 'a', instance: 'r1' }]))
  await call(P.setScreen, lab([{ panel: 'b', instance: 'r2' }]))
  expect((await call(P.placements, {})).value).toEqual([{ screen: '/lab', panel: 'b', instance: 'r2' }])
})

test('refused: a bad path, an unknown system, an empty title', async () => {
  const { call } = setup()
  expect('error' in await call(P.setScreen, lab([], 'lab'))).toBe(true)
  expect('error' in await call(P.setScreen, { ...lab(), system: 'nope' })).toBe(true)
  expect('error' in await call(P.setScreen, { ...lab(), title: ' ' })).toBe(true)
  expect((await call(P.screens)).value).toEqual([])
})

test('removeScreen drops its placements', async () => {
  const { call } = setup()
  await call(P.setScreen, lab([{ panel: 'a', instance: 'r1' }]))
  await call(P.removeScreen, '/lab')
  expect((await call(P.screens)).value).toEqual([])
  expect((await call(P.placements, {})).value).toEqual([])
})

test('moveScreen reorders, and refuses at an end', async () => {
  const { call } = setup()
  for (const id of ['/a', '/b', '/c']) await call(P.setScreen, lab([], id))
  await call(P.moveScreen, { id: '/c', by: -1 })
  expect((await call(P.screens)).value.map((s: any) => s.id)).toEqual(['/a', '/c', '/b'])
  expect('error' in await call(P.moveScreen, { id: '/a', by: -1 })).toBe(true)
  expect('error' in await call(P.moveScreen, { id: '/b', by: 1 })).toBe(true)
})

test("changed fires with what: 'screens'", async () => {
  const { call, events } = setup()
  await call(P.setScreen, lab())
  await call(P.removeScreen, '/lab')
  expect(events.filter(e => e.what === 'screens')).toEqual([{ what: 'screens', ref: 'screen:/lab' }, { what: 'screens', ref: 'screen:/lab' }])
})
