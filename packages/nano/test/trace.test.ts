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
import { Pod } from '../src/pod.ts'
import type { Policy } from '../src/policy.ts'
import { createRuntime, type Runtime, type RuntimeEvent } from '../src/runtime/index.ts'

const Num = defineSchema('Num', Type.Number())
const Str = defineSchema('Str', Type.String())
const Ticks = iface('acme/ticks', { tick: op.source('tick', Num) })
const Log = iface('acme/log', { write: op.sink('write', Num) })
const DB = iface('acme/db', { get: op.action('get', Str, Str) })
const TICK = portKey(Ticks.coord, Ticks.ops.tick.coord)
const WRITE = portKey(Log.coord, Log.ops.write.coord)
const GET = portKey(DB.coord, DB.ops.get.coord)
const Probe = iface('acme/probe', { probe: op.action('probe', Str, Str) })

/** Contexts are made by a runtime per invocation: this handler keeps the last one it was given. */
let caught: NanoContext | undefined
const probe = provide(Probe, { probe: async c => { caught = c; return success('') } })
async function ctxOf(rt: Runtime, coord: string): Promise<NanoContext> {
  await rt.call(coord).probe('')
  return caught!
}
const ticker = implementation('acme/clock/ticker', { provides: [Ticks, Probe], make: () => [probe] })
const memLog = implementation('acme/log/mem', { provides: [Log], make: () => [provide(Log, { write: async () => success(undefined) })] })
const memDb = implementation('acme/db/mem', { provides: [DB], make: () => [provide(DB, { get: async (_c, k) => success(k) })] })
const badDb = implementation('acme/db/bad', { provides: [DB], make: () => [provide(DB, { get: async () => { throw new Error('kaput') } })] })
const main = implementation('acme/app/main', { provides: [Probe], dependencies: { store: DB }, make: () => [probe] })
const boom = implementation('acme/bad/boom', { provides: [], make: () => { throw new Error('nope') } })
const all = [ticker, memLog, memDb, badDb, main, boom]

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
  /** Register a new pod of `implementation`: its coord. */
  const add = (coord: string) => { const r = rt.register(Pod.create(all.find(i => i.coord === coord)!)); if (!r.ok) throw new Error(r.fail.reason); return r.value }
  return { rt, events, add }
}
const settle = () => new Promise(r => setTimeout(r, 0))
const D = 'acme/db/mem#0', M = 'acme/app/main#0', T = 'acme/clock/ticker#0'
const without = (es: RuntimeEvent[], ...types: RuntimeEvent['type'][]) => es.filter(e => !types.includes(e.type))

describe('one stream per runtime', () => {
  test('registering a pod emits pod-created, then its state: starting, then running', async () => {
    const { events, add } = setup()
    const l = add('acme/log/mem')
    await settle()
    expect(events).toEqual([
      { type: 'pod-created', coord: l, implementation: 'acme/log/mem' },
      { type: 'pod-state', coord: l, state: 'starting' }, { type: 'pod-state', coord: l, state: 'running' },
    ])
  })
  test('a make that throws emits the pod failed, with the reason', async () => {
    const { events, add } = setup()
    const x = add('acme/bad/boom')
    await settle()
    expect(events).toContainEqual({ type: 'pod-state', coord: x, state: 'failed', reason: 'acme/bad/boom: nope' })
  })
  test('a call emits sent then delivered, with the subscription, the result and its duration', async () => {
    const { rt, events, add } = setup()
    rt.subscribe({ kind: 'call', from: add('acme/app/main'), to: add('acme/db/mem') })
    const ctx = await ctxOf(rt, M)
    events.length = 0
    expect(await ctx.one(DB, db => db.get('k'))).toEqual(success('k'))
    expect(events).toEqual([
      { type: 'sent', id: 'm2', subscription: 's1', from: M, to: D, port: GET, kind: 'call' },
      { type: 'delivered', id: 'm2', result: success('k'), ms: expect.any(Number) },
    ])
  })
  test('a denied call emits sent then denied, and is not counted', async () => {
    const { rt, events, add } = setup({ isAllowed: (_f, _t, d) => (d === 'secret' ? { approved: false, reason: 'no secrets' } : { approved: true }) })
    rt.subscribe({ kind: 'call', from: add('acme/app/main'), to: add('acme/db/mem') })
    const ctx = await ctxOf(rt, M)
    events.length = 0
    expect(await ctx.one(DB, db => db.get('secret'))).toMatchObject({ ok: false, fail: { type: 'denied' } })
    expect(events).toEqual([
      { type: 'sent', id: 'm2', subscription: 's1', from: M, to: D, port: GET, kind: 'call' },
      { type: 'denied', id: 'm2', reason: 'no secrets' },
    ])
    expect(rt.books('s1')).toEqual({ calls: 0 })
  })
  test('a publish emits sent and delivered for each delivery', async () => {
    const { rt, events, add } = setup()
    const t = add('acme/clock/ticker'), logs = [add('acme/log/mem'), add('acme/log/mem')]
    for (const to of logs) rt.subscribe({ kind: 'event', from: t, source: TICK, to, target: WRITE })
    const ctx = await ctxOf(rt, T)
    events.length = 0
    await ctx.publish(Ticks.ops.tick, 1)
    expect(events.filter(e => e.type === 'sent')).toEqual([
      { type: 'sent', id: 'm2', subscription: 's1', from: t, to: logs[0], port: WRITE, kind: 'event' },
      { type: 'sent', id: 'm3', subscription: 's2', from: t, to: logs[1], port: WRITE, kind: 'event' },
    ])
    expect(events.filter(e => e.type === 'delivered').map(e => e.type === 'delivered' && [e.id, e.result])).toEqual([['m2', success(undefined)], ['m3', success(undefined)]])
  })
  test('a handler that throws emits a failure for its pod', async () => {
    const { rt, events, add } = setup()
    const d = add('acme/db/bad')
    rt.subscribe({ kind: 'call', from: add('acme/app/main'), to: d })
    const ctx = await ctxOf(rt, M)
    events.length = 0
    await ctx.one(DB, db => db.get('k'))
    expect(events.map(e => e.type)).toEqual(['sent', 'failure', 'delivered'])
    expect(events[1]).toEqual({ type: 'failure', coord: d, reason: 'acme/db/bad: kaput' })
  })
  test('unregistering a pod emits subscription-removed with reason cascade for each of its subscriptions, then pod-removed', () => {
    const { rt, events, add } = setup()
    const t = add('acme/clock/ticker'), l = add('acme/log/mem')
    rt.subscribe({ kind: 'event', from: t, source: TICK, to: l, target: WRITE })
    rt.subscribe({ kind: 'event', from: t, source: TICK, to: l, target: WRITE })
    events.length = 0
    rt.unregister(l)
    expect(without(events, 'status')).toEqual([
      { type: 'subscription-removed', id: 's1', reason: 'cascade' }, { type: 'subscription-removed', id: 's2', reason: 'cascade' },
      { type: 'pod-removed', coord: l },
    ])
  })
  test('warn puts a warning on the stream', () => {
    const { rt, events } = setup()
    rt.warn('client: something skipped')
    expect(events).toEqual([{ type: 'warning', reason: 'client: something skipped' }])
  })
  test('a listener that throws never breaks the runtime', () => {
    const { rt, events, add } = setup()
    rt.listen(() => { throw new Error('listener') })
    const after: RuntimeEvent[] = []
    rt.listen(e => after.push(e))
    add('acme/log/mem')
    expect(after).toEqual(events)
    expect(after).toHaveLength(2)
  })
})
