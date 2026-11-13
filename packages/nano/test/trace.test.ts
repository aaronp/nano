import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, portKey } from '../src/iface.ts'
import { success } from '../src/result.ts'
import { implementation, provide } from '../src/implementation.ts'
import { provider } from '../src/provider.ts'
import { createRegistry } from '../src/registry.ts'
import type { NanoContext } from '../src/context.ts'
import type { Policy } from '../src/policy.ts'
import { createRuntime, type RuntimeEvent } from '../src/runtime/index.ts'
import { createApplication } from '../src/application.ts'

const Num = defineSchema('Num', Type.Number())
const Str = defineSchema('Str', Type.String())
const Ticks = iface('acme/ticks', { tick: op.source('tick', Num) })
const Log = iface('acme/log', { write: op.sink('write', Num) })
const DB = iface('acme/db', { get: op.action('get', Str, Str) })
const TICK = portKey(Ticks.coord, Ticks.ops.tick.coord)
const WRITE = portKey(Log.coord, Log.ops.write.coord)
const GET = portKey(DB.coord, DB.ops.get.coord)

const contexts = new Map<string, NanoContext>()
const capture = (ctx: NanoContext) => { contexts.set(ctx.instance, ctx); return [] }
const ticker = implementation('acme/clock/ticker', { provides: [Ticks], make: capture })
const memLog = implementation('acme/log/mem', { provides: [Log], make: () => [provide(Log, { write: async () => success(undefined) })] })
const memDb = implementation('acme/db/mem', { provides: [DB], make: () => [provide(DB, { get: async (_c, k) => success(k) })] })
const badDb = implementation('acme/db/bad', { provides: [DB], make: () => [provide(DB, { get: async () => { throw new Error('kaput') } })] })
const main = implementation('acme/app/main', { provides: [], dependencies: { store: DB }, make: capture })
const boom = implementation('acme/bad/boom', { provides: [], make: () => { throw new Error('nope') } })

const registry = () => {
  const r = createRegistry()
  for (const p of [provider('acme/clock', [ticker]), provider('acme/log', [memLog]), provider('acme/db', [memDb, badDb]), provider('acme/app', [main]), provider('acme/bad', [boom])])
    r.add(p)
  return r
}
function setup(policy?: Policy) {
  const rt = createRuntime('r1', { registry: registry(), ...(policy && { policy }) })
  const events: RuntimeEvent[] = []
  rt.listen(e => events.push(e))
  return { rt, events }
}
const without = (es: RuntimeEvent[], ...types: RuntimeEvent['type'][]) => es.filter(e => !types.includes(e.type))

describe('one stream per runtime', () => {
  test('creating a pod emits pod-created, then an instance starting and running for each instance', async () => {
    const { rt, events } = setup()
    await rt.create('b', 'acme/log/mem', { count: 2 })
    expect(events).toEqual([
      { type: 'pod-created', pod: 'b', implementation: 'acme/log/mem' },
      { type: 'instance', coord: 'b#0', state: 'starting' }, { type: 'instance', coord: 'b#1', state: 'starting' },
      { type: 'instance', coord: 'b#0', state: 'running' }, { type: 'instance', coord: 'b#1', state: 'running' },
    ])
  })
  test('a make that throws emits the instance failed, with the reason', async () => {
    const { rt, events } = setup()
    await rt.create('x', 'acme/bad/boom')
    expect(events).toContainEqual({ type: 'instance', coord: 'x#0', state: 'failed', reason: 'x#0: nope' })
  })
  test('a call emits sent then delivered, with the subscription, the result and its duration', async () => {
    const { rt, events } = setup()
    await rt.create('d', 'acme/db/mem'); await rt.create('m', 'acme/app/main')
    rt.subscribe({ kind: 'call', from: 'm#0', to: 'd#0' })
    events.length = 0
    expect(await contexts.get('m#0')!.one(DB, db => db.get('k'))).toEqual(success('k'))
    expect(events).toEqual([
      { type: 'sent', id: 'm1', subscription: 's1', from: 'm#0', to: 'd#0', port: GET, kind: 'call' },
      { type: 'delivered', id: 'm1', result: success('k'), ms: expect.any(Number) },
    ])
  })
  test('a denied call emits sent then denied, and is not counted', async () => {
    const { rt, events } = setup({ isAllowed: (_f, _t, d) => (d === 'secret' ? { approved: false, reason: 'no secrets' } : { approved: true }) })
    await rt.create('d', 'acme/db/mem'); await rt.create('m', 'acme/app/main')
    rt.subscribe({ kind: 'call', from: 'm#0', to: 'd#0' })
    events.length = 0
    expect(await contexts.get('m#0')!.one(DB, db => db.get('secret'))).toMatchObject({ ok: false, fail: { type: 'denied' } })
    expect(events).toEqual([
      { type: 'sent', id: 'm1', subscription: 's1', from: 'm#0', to: 'd#0', port: GET, kind: 'call' },
      { type: 'denied', id: 'm1', reason: 'no secrets' },
    ])
    expect(rt.books('s1')).toEqual({ calls: 0 })
  })
  test('a publish emits sent and delivered for each delivery', async () => {
    const { rt, events } = setup()
    await rt.create('t', 'acme/clock/ticker'); await rt.create('l', 'acme/log/mem', { count: 2 })
    for (const to of ['l#0', 'l#1']) rt.subscribe({ kind: 'event', from: 't#0', source: TICK, to, target: WRITE })
    events.length = 0
    await contexts.get('t#0')!.publish(Ticks.ops.tick, 1)
    const sent = events.filter(e => e.type === 'sent')
    expect(sent).toEqual([
      { type: 'sent', id: 'm1', subscription: 's1', from: 't#0', to: 'l#0', port: WRITE, kind: 'event' },
      { type: 'sent', id: 'm2', subscription: 's2', from: 't#0', to: 'l#1', port: WRITE, kind: 'event' },
    ])
    expect(events.filter(e => e.type === 'delivered').map(e => e.type === 'delivered' && [e.id, e.result])).toEqual([['m1', success(undefined)], ['m2', success(undefined)]])
  })
  test('a handler that throws emits a failure for its instance', async () => {
    const { rt, events } = setup()
    await rt.create('d', 'acme/db/bad'); await rt.create('m', 'acme/app/main')
    rt.subscribe({ kind: 'call', from: 'm#0', to: 'd#0' })
    events.length = 0
    await contexts.get('m#0')!.one(DB, db => db.get('k'))
    expect(events.map(e => e.type)).toEqual(['sent', 'failure', 'delivered'])
    expect(events[1]).toEqual({ type: 'failure', coord: 'd#0', reason: 'd#0: kaput' })
  })
  test('removing a pod emits subscription-removed with reason cascade for each of its subscriptions, then pod-removed', async () => {
    const { rt, events } = setup()
    await rt.create('t', 'acme/clock/ticker'); await rt.create('l', 'acme/log/mem', { count: 2 })
    for (const to of ['l#0', 'l#1']) rt.subscribe({ kind: 'event', from: 't#0', source: TICK, to, target: WRITE })
    events.length = 0
    rt.remove('l')
    expect(without(events, 'status')).toEqual([
      { type: 'instance', coord: 'l#0', state: 'stopped' }, { type: 'instance', coord: 'l#1', state: 'stopped' },
      { type: 'subscription-removed', id: 's1', reason: 'cascade' }, { type: 'subscription-removed', id: 's2', reason: 'cascade' },
      { type: 'pod-removed', pod: 'l' },
    ])
  })
  test('a skipped member while starting emits a warning (and app.notes() lists it)', async () => {
    const app = createApplication('app', { registry: registry() })
    const events: RuntimeEvent[] = []
    app.listen(e => events.push(e))
    app.define({ id: 'client', pods: [], members: [{ pod: 's', home: 'nowhere' }], subscriptions: [] })
    expect((await app.start('client')).ok).toBe(true)
    expect(app.notes()).toEqual(['client: member s skipped: no runtime nowhere'])
    expect(events).toEqual([{ type: 'warning', reason: 'client: member s skipped: no runtime nowhere' }])
  })
  test('a listener that throws never breaks the runtime', async () => {
    const { rt, events } = setup()
    rt.listen(() => { throw new Error('listener') })
    const after: RuntimeEvent[] = []
    rt.listen(e => after.push(e))
    expect((await rt.create('b', 'acme/log/mem')).ok).toBe(true)
    expect(after).toEqual(events)
    expect(after).toHaveLength(3)
  })
})
