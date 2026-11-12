import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes, type Op } from '@pritzlaff/nano-core'
import { catalog } from '@composable/bundle'
import { application, ApplicationOps as P, runtimeOf } from '../src/application'

const setup = async () => {
  const host = Runtimes.create(Registries.create('host'))
  host.registry.add('application', Components.instantiate(application(host, catalog, { placementsOf: l => (l as any).p ?? [] })))
  const call = (op: Op, arg: unknown = null) => host.call({ registry: 'host', instance: 'test' }, 'application', Ops.key(op), arg) as Promise<any>
  await call(P.createSystem, 'lab')
  await call(P.createComponent, { kind: 'range', name: 'r1', system: 'host' })
  await call(P.createComponent, { kind: 'log', name: 'l1', system: 'lab' })
  await call(P.setScreen, { id: '/lab', title: 'Lab', system: 'lab', layout: { p: [{ panel: 'a', instance: 'l1' }, { panel: 'b', instance: 'ghost' }] } })
  return { call, host }
}
const q = async (call: any, f: object) => (await call(P.query, f)).value

test('query with no filters is every instance in every system', async () => {
  const { call, host } = await setup()
  const all = (await q(call, {})) as string[]
  const want = ['host', 'lab'].flatMap(s => runtimeOf(host.registry, s)!.registry.snapshot().instances.map(i => `instance:${s}/${i.id}`)).sort()
  expect(all).toEqual(want)
  expect(all).toContain('instance:host/application')
  expect(all).toContain('instance:host/r1')
})

test('filters AND together', async () => {
  const { call } = await setup()
  expect(await q(call, { system: 'lab', kind: 'log' })).toEqual(['instance:lab/l1'])
  expect(await q(call, { screen: '/lab', kind: 'range' })).toEqual([])
})

test('tag and query by tag', async () => {
  const { call } = await setup()
  await call(P.tag, { ref: 'instance:host/r1', tag: 'billing' })
  expect(await q(call, { tag: 'billing' })).toEqual(['instance:host/r1'])
  expect((await call(P.tagsOf, 'instance:host/r1')).value).toEqual(['billing'])
  expect((await call(P.allTags)).value).toEqual({ 'instance:host/r1': ['billing'] })
})

test('screens and systems can be tagged too', async () => {
  const { call } = await setup()
  await call(P.tag, { ref: 'screen:/lab', tag: 'team' })
  await call(P.tag, { ref: 'system:lab', tag: 'team' })
  expect((await call(P.tagged, 'team')).value).toEqual(['screen:/lab', 'system:lab'])
})

test('an instance removed by any route loses its tags and leaves queries', async () => {
  const { call, host } = await setup()
  await call(P.tag, { ref: 'instance:host/r1', tag: 'billing' })
  host.registry.remove('r1')
  expect((await call(P.tagged, 'billing')).value).toEqual([])
  expect(await q(call, {})).not.toContain('instance:host/r1')
})

test('a placement whose instance is gone is not returned', async () => {
  const { call } = await setup()
  expect(await q(call, { screen: '/lab' })).toEqual(['instance:lab/l1'])
  expect((await call(P.screensOf, 'instance:lab/ghost')).value).toEqual([])
  expect((await call(P.screensOf, 'instance:lab/l1')).value).toEqual(['/lab'])
})

test('removing a screen removes its tags', async () => {
  const { call } = await setup()
  await call(P.tag, { ref: 'screen:/lab', tag: 'team' })
  await call(P.removeScreen, '/lab')
  expect((await call(P.tagged, 'team')).value).toEqual([])
})

test('bad refs are refused', async () => {
  const { call } = await setup()
  expect('error' in await call(P.tag, { ref: 'nope', tag: 'x' })).toBe(true)
  expect('error' in await call(P.tag, { ref: 'instance:host/missing', tag: 'x' })).toBe(true)
  expect('error' in await call(P.tag, { ref: 'screen:/missing', tag: 'x' })).toBe(true)
  expect('error' in await call(P.untag, { ref: 'system:nope', tag: 'x' })).toBe(true)
})

test("a tag change fires changed with what: 'tags'", async () => {
  const { call, host } = await setup()
  const events: any[] = []
  const spy = Components.create({ ns: 't', name: 'spy' }, () => events)
  spy.action(Ops.sink('t', 'take', P.changed.output!), (e, x) => { e.push(x) })
  host.registry.add('spy', Components.instantiate(spy))
  host.registry.subscribe({ source: 'application', op: Ops.key(P.changed), listener: 'spy', target: 't/take' })
  await call(P.tag, { ref: 'system:lab', tag: 'x' })
  await call(P.untag, { ref: 'system:lab', tag: 'x' })
  expect(events.filter(e => e.what === 'tags')).toEqual([{ what: 'tags', ref: 'system:lab' }, { what: 'tags', ref: 'system:lab' }])
})
