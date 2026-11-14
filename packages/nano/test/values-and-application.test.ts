/**
 * Values and a live application (spec: docs/superpowers/specs/2026-11-14-values-and-application-design.md), written
 * first. Pods and deployments are plain values; `Application.create(deployment)` is the one live thing. A factory
 * `make(ctx, config)` runs lazily (or eagerly), closes over its state and its pod-scoped ctx; handlers take input only.
 */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import {
  Application, Pod, createRegistry, defineSchema, iface, implementation, op, provide, provider, sel, success,
  type AppEvent, type Deployment, type NanoContext, type Policy,
} from '../src/index.ts'

const Str = defineSchema('Str', Type.String())
const Num = defineSchema('Num', Type.Integer())
const Nothing = defineSchema('Nothing', Type.Null())
const Rows = defineSchema('Rows', Type.Array(Type.String()))

const Counter = iface('acme.Counter', { inc: op.action('inc', Nothing, Num) })
const KV = iface('acme.KV', { get: op.action('get', Str, Str), put: op.action('put', Str, Nothing) })
const Send = iface('acme.Send', { send: op.action('send', Str, Nothing) })
const Ticks = iface('acme.Ticks', { tick: op.event('tick', Num) })
const Log = iface('acme.Log', { record: op.action('record', Num, Nothing) })
const DB = iface('acme.DB', { all: op.action('all', Nothing, Rows), insert: op.action('insert', Rows, Nothing) })
const Run = iface('acme.Run', { run: op.action('run', Nothing, Num) })
const Bad = iface('acme.Bad', { go: op.action('go', Str, Num) })

let builds: string[] = []
/** A counter whose state is a closure: 1, 2, 3 … per instance. Records each build. */
const counter = implementation('acme/counter', { provides: [Counter], make: (ctx) => {
  builds.push(ctx.self); let n = 0
  return [provide(Counter, { inc: async () => success(++n) })]
} })
let failNext = 0
const flaky = implementation('acme/flaky', { provides: [Counter], make: () => {
  if (failNext > 0) { failNext--; throw new Error('not yet') }
  return [provide(Counter, { inc: async () => success(1) })]
} })
const kv = implementation('acme/kv', { provides: [KV], make: () => {
  const m = new Map<string, string>()
  return [provide(KV, { get: async k => success(m.get(k) ?? ''), put: async k => { m.set(k, 'v'); return success(null) } })]
} })
/** Sends by putting into whichever KV it is wired to; never names a runtime. */
const sender = implementation('acme/sender', { provides: [Send], dependencies: { store: KV }, make: ctx => [provide(Send, {
  send: async msg => { const s = ctx.one(KV); return s.ok ? s.value.put(msg) : s },
})] })
/** Falls back to a local note when no KV is wired. */
const adaptive = implementation('acme/adaptive', { provides: [Send], dependencies: { store: KV }, make: ctx => {
  const local: string[] = []
  return [provide(Send, { send: async msg => {
    if (ctx.all(KV).length === 0) { local.push(msg); return success(null) }
    const s = ctx.one(KV); return s.ok ? s.value.put(msg) : s
  } })]
} })
const ticker = implementation('acme/ticker', { provides: [Ticks], make: () => [] })
let logged: number[] = []
const log = implementation('acme/log', { provides: [Log], make: () => [provide(Log, { record: async n => { logged.push(n); return success(null) } })] })
const db = implementation('acme/db', { provides: [DB], make: (_ctx, seed: string[] = []) => {
  const rows = [...seed]
  return [provide(DB, { all: async () => success([...rows]), insert: async more => { rows.push(...more); return success(null) } })]
} })
/** Copies rows from config.from to config.to, naming runtimes only through config. */
const migrate = implementation('acme/migrate', { provides: [Run], dependencies: { db: DB }, make: (ctx, cfg) => [provide(Run, { run: async () => {
  const from = ctx.one(sel(DB, { runtime: cfg.from })), to = ctx.one(sel(DB, { runtime: cfg.to }))
  if (!from.ok) return from
  if (!to.ok) return to
  const rows = await from.value.all(null)
  if (!rows.ok) return rows
  const put = await to.value.insert(rows.value)
  return put.ok ? success(rows.value.length) : put
} })] })
const careless = implementation('acme/careless', { provides: [Run], dependencies: { db: DB }, make: ctx => [provide(Run, { run: async () => {
  const d = ctx.one(DB); return d.ok ? success(0) : d
} })] })
/** Each instance's first call waits until the test opens every gate. */
let gates: (() => void)[] = []
const openAll = () => { for (const g of gates.splice(0)) g() }
const gated = implementation('acme/gated', { provides: [Counter], make: () => {
  let n = 0
  return [provide(Counter, { inc: async () => { const mine = ++n; if (mine === 1) await new Promise<void>(r => gates.push(r)); return success(mine) } })]
} })
const bad = implementation('acme/bad', { provides: [Bad], make: () => [provide(Bad, { go: async (x: string) => {
  if (x === 'out') return success('not a number' as unknown as number)
  if (x === 'slow') return new Promise(() => {})
  if (x === 'throw') throw new Error('bang')
  return success(1)
} })] })
let seen: string[] = []
const where = implementation('acme/where', { provides: [Counter], make: ctx => [provide(Counter, { inc: async () => { seen = [...ctx.runtimes]; return success(1) } })] })

const registry = () => {
  const r = createRegistry()
  r.add(provider('acme', [counter, flaky, kv, sender, adaptive, ticker, log, db, migrate, careless, gated, bad, where]))
  return r
}
const ok = <T>(r: { ok: boolean; value?: T; fail?: { reason: string } }): T => { if (!r.ok) throw new Error(r.fail!.reason); return r.value as T }
/** A live application and everything on its stream. */
const live = async (deployment: unknown, opts: { policies?: Record<string, Policy>; timeoutMs?: number } = {}) => {
  const app = ok(await Application.create(deployment, { registry: registry(), ...opts }))
  const events: AppEvent[] = []
  app.listen(e => events.push(e))
  return { app, events }
}
const sent = (events: AppEvent[], runtime?: string) =>
  events.flatMap(e => (e.type === 'sent' && (!runtime || e.runtime === runtime) ? [`${e.from}->${e.to}`] : []))
const one = (pods: Deployment['pods'], subscriptions: Deployment['runtimes'][string]['subscriptions'] = [], extra = {}) => ({ pods, runtimes: { r: { pods: Object.keys(pods), subscriptions } }, ...extra })

describe('values', () => {
  // Behaviour 1.
  test('given lazy and eager pods in a deployment, when it is JSON round-tripped, then it is unchanged plain data', () => {
    const d = one({ c: Pod.lazy(counter, { config: { start: 1 } }), t: Pod.eager(ticker) })
    expect(d.pods.c).toEqual({ implementation: 'acme/counter', config: { start: 1 }, eager: false })
    expect(d.pods.t).toEqual({ implementation: 'acme/ticker', eager: true })
    expect(JSON.parse(JSON.stringify(d))).toEqual(d)
  })
})

describe('building', () => {
  // Behaviour 2.
  test('given an eager and a lazy pod, when the application is created, then the eager one is built before it resolves and the lazy one only on its first call', async () => {
    builds = []
    const { app, events } = await live(one({ e: Pod.eager(counter), l: Pod.lazy(counter) }))
    expect(builds).toEqual(['e'])
    await app.call('r', 'l').inc(null)
    expect(builds).toEqual(['e', 'l'])
    expect(events.filter(e => e.type === 'built').map(e => e.pod)).toEqual(['l'])
  })
  // Behaviour 3.
  test('given a lazy pod, when two first calls race, then it is built once', async () => {
    builds = []
    const { app } = await live(one({ c: Pod.lazy(counter) }))
    const [a, b] = await Promise.all([app.call('r', 'c').inc(null), app.call('r', 'c').inc(null)])
    expect(builds).toEqual(['c'])
    expect([ok(a), ok(b)].sort()).toEqual([1, 2])
  })
  // Behaviour 4.
  test('given a factory that throws once, when called twice, then the first call fails threw and the second builds and answers', async () => {
    failNext = 1
    const { app, events } = await live(one({ f: Pod.lazy(flaky) }))
    expect(await app.call('r', 'f').inc(null)).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(events).toContainEqual(expect.objectContaining({ type: 'failure', pod: 'f' }))
    expect(await app.call('r', 'f').inc(null)).toEqual(success(1))
  })
  test('given an eager pod whose factory throws, when the application is created, then create succeeds and the pod builds on its first call', async () => {
    failNext = 1
    const r = await Application.create(one({ f: Pod.eager(flaky) }), { registry: registry() })
    expect(r.ok).toBe(true)
    expect(await ok(r).call('r', 'f').inc(null)).toEqual(success(1))
  })
  // Behaviour 5.
  test('given a counter at 2 with a call in flight, when it is restarted, then the next call answers 1 and the call in flight finishes on the old instance', async () => {
    const { app } = await live(one({ g: Pod.lazy(gated) }))
    gates = []
    const inFlight = app.call('r', 'g').inc(null)           // the old instance's first call waits at its gate
    await new Promise(r => setTimeout(r, 0))
    expect(await app.call('r', 'g').inc(null)).toEqual(success(2))
    expect(await app.restart('g')).toEqual(success(undefined))
    const fresh = app.call('r', 'g').inc(null)                 // a fresh closure: its first call is 1 and waits too
    await new Promise(r => setTimeout(r, 0))
    openAll()
    expect(await inFlight).toEqual(success(1))
    expect(await fresh).toEqual(success(1))
  })
})

describe('placing', () => {
  // Behaviour 6.
  test('given one pod placed in two runtimes, when called through each, then there is one instance, ctx.runtimes names both, and each call is recorded only in its runtime', async () => {
    const { app, events } = await live({ pods: { c: Pod.lazy(counter), w: Pod.lazy(where) },
      runtimes: { a: { pods: ['c', 'w'], subscriptions: [] }, b: { pods: ['c', 'w'], subscriptions: [] } } })
    expect(await app.call('a', 'c').inc(null)).toEqual(success(1))
    expect(await app.call('b', 'c').inc(null)).toEqual(success(2))
    expect(sent(events, 'a')).toEqual(['host->c'])
    expect(sent(events, 'b')).toEqual(['host->c'])
    await app.call('b', 'w').inc(null)
    expect(seen).toEqual(['a', 'b'])
  })
  // Behaviour 7.
  test('given send in messaging, chat and support wired to db only in messaging, when chat sends, then the db call is recorded in messaging and chat cannot reach db', async () => {
    const { app, events } = await live({ pods: { send: Pod.lazy(sender), db: Pod.lazy(kv) }, runtimes: {
      messaging: { pods: ['send', 'db'], subscriptions: [{ kind: 'call', from: 'send', to: 'db' }] },
      chat: { pods: ['send'], subscriptions: [] }, support: { pods: ['send'], subscriptions: [] },
    } })
    expect(await app.call('chat', 'send').send('hi')).toEqual(success(null))
    expect(sent(events, 'chat')).toEqual(['host->send'])
    expect(sent(events, 'messaging')).toEqual(['send->db'])
    expect(await app.call('chat', 'db').get('hi')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.call('messaging', 'db').get('hi')).toEqual(success('v'))
  })
  // Behaviour 8.
  test('given etl wired to a source db in foo and a sink db in bar, when run, then it reads in foo and writes in bar', async () => {
    const { app, events } = await live({ pods: { etl: Pod.lazy(migrate, { config: { from: 'foo', to: 'bar' } }), src: Pod.lazy(db, { config: ['a', 'b'] }), dst: Pod.lazy(db) }, runtimes: {
      foo: { pods: ['etl', 'src'], subscriptions: [{ kind: 'call', from: 'etl', to: 'src' }] },
      bar: { pods: ['etl', 'dst'], subscriptions: [{ kind: 'call', from: 'etl', to: 'dst' }] },
    } })
    expect(await app.call('foo', 'etl').run(null)).toEqual(success(2))
    expect(sent(events, 'foo')).toEqual(['host->etl', 'etl->src'])
    expect(sent(events, 'bar')).toEqual(['etl->dst'])
    expect(await app.call('bar', 'dst').all(null)).toEqual(success(['a', 'b']))
  })
  // Behaviour 9.
  test('given a db wired in v2 and in v3, when a pod asks one(DB) without a runtime, then it is ambiguous', async () => {
    const { app } = await live({ pods: { m: Pod.lazy(careless), d2: Pod.lazy(db), d3: Pod.lazy(db) }, runtimes: {
      v2: { pods: ['m', 'd2'], subscriptions: [{ kind: 'call', from: 'm', to: 'd2' }] },
      v3: { pods: ['m', 'd3'], subscriptions: [{ kind: 'call', from: 'm', to: 'd3' }] },
    } })
    expect(await app.call('v2', 'm').run(null)).toMatchObject({ ok: false, fail: { type: 'ambiguous' } })
  })
})

describe('messages', () => {
  // Behaviour 10.
  test('given a ticker in two runtimes with a log subscribed in each, when it publishes, then each subscription gets it, recorded in its runtime', async () => {
    logged = []
    let ctxOut: NanoContext | undefined
    const tick = implementation('acme2/tick', { provides: [Ticks], make: ctx => { ctxOut = ctx; return [] } })
    const reg = registry(); reg.add(provider('acme2', [tick]))
    const ev = { kind: 'event', from: 't', source: 'acme.Ticks/tick', to: 'l', target: 'acme.Log/record' } as const
    const app = ok(await Application.create({ pods: { t: Pod.eager(tick), l: Pod.lazy(log) }, runtimes: {
      a: { pods: ['t', 'l'], subscriptions: [ev] }, b: { pods: ['t', 'l'], subscriptions: [ev] } } }, { registry: reg }))
    const events: AppEvent[] = []; app.listen(e => events.push(e))
    await ctxOut!.publish(Ticks.ops.tick, 7)
    expect(logged).toEqual([7, 7])
    expect(sent(events, 'a')).toEqual(['t->l'])
    expect(sent(events, 'b')).toEqual(['t->l'])
  })
  // Behaviour 11.
  test('given a policy that refuses, when the host calls, then the call fails denied and the stream shows sent then denied', async () => {
    const policies: Record<string, Policy> = { r: { isAllowed: (_f, t) => ({ approved: false, reason: `no ${t}` }) } }
    const { app, events } = await live(one({ c: Pod.lazy(counter) }), { policies })
    expect(await app.call('r', 'c').inc(null)).toMatchObject({ ok: false, fail: { type: 'denied', reason: 'no c' } })
    const id = events.flatMap(e => (e.type === 'sent' ? [e.id] : []))[0]
    expect(events).toContainEqual(expect.objectContaining({ type: 'denied', id }))
  })
  // Behaviour 14.
  test('given a misbehaving handler, when called with bad input, bad output, a throw and a hang, then each is the right Fail and the pod keeps serving', async () => {
    const { app } = await live(one({ b: Pod.lazy(bad) }), { timeoutMs: 20 })
    const c = app.call('r', 'b')
    expect(await c.go(42)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(await c.go('out')).toMatchObject({ ok: false, fail: { type: 'invalid-output' } })
    expect(await c.go('throw')).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(await c.go('slow')).toMatchObject({ ok: false, fail: { type: 'timeout' } })
    expect(await c.nope(null)).toMatchObject({ ok: false, fail: { type: 'unknown-op' } })
    expect(await c.go('ok')).toEqual(success(1))
  })
  // Behaviour 16.
  test('given a component with no store wired, when it sends, then ctx.all(KV) is empty and it falls back', async () => {
    const { app } = await live(one({ a: Pod.lazy(adaptive) }))
    expect(await app.call('r', 'a').send('hi')).toEqual(success(null))
  })
})

describe('changing', () => {
  // Behaviour 12.
  test.todo('given a running application, when a subscription is added, a pod removed and a config changed by apply, then each takes effect and deployment() is the value applied', async () => {
    const d: Deployment = { pods: { send: Pod.lazy(sender), db: Pod.lazy(kv), c: Pod.lazy(db, { config: ['x'] }), gone: Pod.lazy(counter) },
      runtimes: { r: { pods: ['send', 'db', 'c', 'gone'], subscriptions: [] } } }
    const { app, events } = await live(d)
    expect(await app.call('r', 'send').send('k')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    const next: Deployment = { pods: { send: d.pods.send!, db: d.pods.db!, c: Pod.lazy(db, { config: ['y'] }) },
      runtimes: { r: { pods: ['send', 'db', 'c'], subscriptions: [{ kind: 'call', from: 'send', to: 'db' }] } } }
    expect(await app.apply(next)).toMatchObject({ ok: true })
    expect(await app.call('r', 'send').send('k')).toEqual(success(null))
    expect(await app.call('r', 'gone').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.call('r', 'c').all(null)).toEqual(success(['y']))
    expect(app.deployment()).toEqual(next)
    expect(events).toContainEqual(expect.objectContaining({ type: 'applied' }))
  })
  test.todo('given a policy that refuses a new subscription, when apply adds it, then apply is denied and nothing changes', async () => {
    const policies: Record<string, Policy> = { r: { isAllowed: (_f, _t, data) => (data === 'subscribe' ? { approved: false, reason: 'frozen' } : { approved: true }) } }
    const d = one({ send: Pod.lazy(sender), db: Pod.lazy(kv) })
    const { app } = await live(d, { policies })
    const next: Deployment = { ...d, runtimes: { r: { ...d.runtimes.r!, subscriptions: [{ kind: 'call', from: 'send', to: 'db' }] } } }
    expect(await app.apply(next)).toMatchObject({ ok: false, fail: { type: 'denied', reason: 'frozen' } })
    expect(app.deployment()).toEqual(d)
  })
  // Behaviour 13.
  test.todo('given a saved deployment, when an application is created from its JSON, then it answers the same calls the same way', async () => {
    const d = { pods: { send: Pod.lazy(sender), db: Pod.lazy(kv) },
      runtimes: { r: { pods: ['send', 'db'], subscriptions: [{ kind: 'call', from: 'send', to: 'db' }] } } }
    const first = (await live(d)).app
    const again = (await live(JSON.parse(JSON.stringify(first.deployment())))).app
    for (const app of [first, again]) {
      expect(await app.call('r', 'send').send('k')).toEqual(success(null))
      expect(await app.call('r', 'db').get('k')).toEqual(success('v'))
    }
  })
})

describe('validation', () => {
  // Behaviour 15.
  const cases: [string, () => unknown, string][] = [
    ['a runtime placing an unknown pod', () => ({ pods: {}, runtimes: { r: { pods: ['x'], subscriptions: [] } } }), 'invalid-input'],
    ['a subscription end not placed', () => ({ pods: { s: Pod.lazy(sender), d: Pod.lazy(kv) }, runtimes: { r: { pods: ['s'], subscriptions: [{ kind: 'call', from: 's', to: 'd' }] } } }), 'invalid-input'],
    ['a call to a pod not providing the declared dependency', () => ({ pods: { s: Pod.lazy(sender), c: Pod.lazy(counter) }, runtimes: { r: { pods: ['s', 'c'], subscriptions: [{ kind: 'call', from: 's', to: 'c' }] } } }), 'invalid-input'],
    ['an unknown implementation', () => ({ pods: { x: { implementation: 'acme/nope', eager: false } }, runtimes: { r: { pods: ['x'], subscriptions: [] } } }), 'not-found'],
  ]
  for (const [name, d, type] of cases)
    test(`given ${name}, when the application is created, then it fails ${type}`, async () => {
      expect(await Application.create(d(), { registry: registry() })).toMatchObject({ ok: false, fail: { type } })
    })
})
