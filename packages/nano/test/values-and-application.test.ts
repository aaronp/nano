/**
 * Values and a live application (spec: docs/superpowers/specs/2026-11-14-values-and-application-design.md), written
 * first; ported to `assemble` + `Application.create(runtimes)` (2026-11-14-pods-runtimes-application-design.md,
 * behaviour 12). Pods and deployments are values; the `Application` is the one live thing. A factory
 * `make(ctx, config)` runs lazily (or eagerly), closes over its state and its pod-scoped ctx; handlers take input only.
 */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import {
  Application, Pod, assemble, createRegistry, defineSchema, iface, implementation, op, provide, provider, sel, success,
  type AppEvent, type AppDeployment, type NanoContext, type Policy,
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
/** `d` assembled with `reg`, then made live: the first failure of either. */
const create = async (d: unknown, opts: { policies?: Record<string, Policy>; timeoutMs?: number } = {}, reg = registry()) => {
  const runtimes = assemble(d, reg)
  return runtimes.ok ? Application.create(runtimes.value, opts) : runtimes
}
/** A live application and everything on its stream. */
const live = async (deployment: unknown, opts: { policies?: Record<string, Policy>; timeoutMs?: number } = {}) => {
  const app = ok(await create(deployment, opts))
  const events: AppEvent[] = []
  app.listen(e => events.push(e))
  return { app, events }
}
const sent = (events: AppEvent[], runtime?: string) =>
  events.flatMap(e => (e.type === 'sent' && (!runtime || e.runtime === runtime) ? [`${e.from}->${e.to}`] : []))
const one = (pods: AppDeployment['pods'], subscriptions: AppDeployment['runtimes'][string]['subscriptions'] = [], extra = {}) => ({ pods, runtimes: { r: { pods: Object.keys(pods), subscriptions } }, ...extra })

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
    const r = await create(one({ f: Pod.eager(flaky) }))
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
    const ev = { kind: 'pipe', from: 't', source: 'acme.Ticks/tick', to: 'l', target: 'acme.Log/record' } as const
    const app = ok(await create({ pods: { t: Pod.eager(tick), l: Pod.lazy(log) }, runtimes: {
      a: { pods: ['t', 'l'], subscriptions: [ev] }, b: { pods: ['t', 'l'], subscriptions: [ev] } } }, {}, reg))
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
  test('given a running application, when a subscription is added, a pod removed and a config changed by apply, then each takes effect and deployment() is the value applied', async () => {
    const d: AppDeployment = { pods: { send: Pod.lazy(sender), db: Pod.lazy(kv), c: Pod.lazy(db, { config: ['x'] }), gone: Pod.lazy(counter) },
      runtimes: { r: { pods: ['send', 'db', 'c', 'gone'], subscriptions: [] } } }
    const { app, events } = await live(d)
    expect(await app.call('r', 'send').send('k')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    const next: AppDeployment = { pods: { send: d.pods.send!, db: d.pods.db!, c: Pod.lazy(db, { config: ['y'] }) },
      runtimes: { r: { pods: ['send', 'db', 'c'], subscriptions: [{ kind: 'call', from: 'send', to: 'db' }] } } }
    expect(await app.apply(next)).toMatchObject({ ok: true })
    expect(await app.call('r', 'send').send('k')).toEqual(success(null))
    expect(await app.call('r', 'gone').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.call('r', 'c').all(null)).toEqual(success(['y']))
    expect(app.deployment()).toEqual(next)
    expect(events).toContainEqual(expect.objectContaining({ type: 'applied' }))
  })
  test('given a policy that refuses a new subscription, when apply adds it, then apply is denied and nothing changes', async () => {
    const policies: Record<string, Policy> = { r: { isAllowed: (_f, _t, data) => (data === 'subscribe' ? { approved: false, reason: 'frozen' } : { approved: true }) } }
    const d = one({ send: Pod.lazy(sender), db: Pod.lazy(kv) })
    const { app } = await live(d, { policies })
    const next: AppDeployment = { ...d, runtimes: { r: { ...d.runtimes.r!, subscriptions: [{ kind: 'call', from: 'send', to: 'db' }] } } }
    expect(await app.apply(next)).toMatchObject({ ok: false, fail: { type: 'denied', reason: 'frozen' } })
    expect(app.deployment()).toEqual(d)
  })
  // Behaviour 13.
  test('given a saved deployment, when an application is created from its JSON, then it answers the same calls the same way', async () => {
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

describe('changing, at the edges', () => {
  const tick = () => new Promise(r => setTimeout(r, 0))
  test('given a pod holding a client from ctx.one(KV), when apply removes that subscription, then its next send is not-found', async () => {
    const d: AppDeployment = { pods: { send: Pod.lazy(sender), db: Pod.lazy(kv) },
      runtimes: { r: { pods: ['send', 'db'], subscriptions: [{ kind: 'call', from: 'send', to: 'db' }] } } }
    let kept: Record<string, (i: unknown) => Promise<unknown>> | undefined
    const holder = implementation('acme3/holder', { provides: [Send], dependencies: { store: KV }, make: ctx => {
      return [provide(Send, { send: async msg => {
        if (!kept) { const s = ctx.one(KV); if (!s.ok) return s; kept = s.value as never }
        return kept!.put(msg) as never
      } })]
    } })
    const reg = registry(); reg.add(provider('acme3', [holder]))
    const app = ok(await create({ ...d, pods: { ...d.pods, send: Pod.lazy(holder) } }, {}, reg))
    expect(await app.call('r', 'send').send('k')).toEqual(success(null))
    expect(await app.apply({ ...app.deployment(), runtimes: { r: { pods: ['send', 'db'], subscriptions: [] } } })).toEqual(success(undefined))
    expect(await app.call('r', 'send').send('k')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('given two applies at once, when both run, then they resolve in call order and deployment() is the second', async () => {
    const { app, events } = await live(one({ c: Pod.lazy(counter) }))
    const a = one({ c: Pod.lazy(counter), x: Pod.lazy(kv) }), b = one({ c: Pod.lazy(counter), y: Pod.lazy(kv) })
    const order: string[] = []
    await Promise.all([app.apply(a).then(r => { ok(r); order.push('a') }), app.apply(b).then(r => { ok(r); order.push('b') })])
    expect(order).toEqual(['a', 'b'])
    expect(app.deployment()).toEqual(b)
    expect(events.filter(e => e.type === 'applied')).toEqual([
      { type: 'applied', added: ['x'], removed: [], changed: [], rewired: ['r'] },
      { type: 'applied', added: ['y'], removed: ['x'], changed: [], rewired: ['r'] },
    ])
  })
  test('given a call in flight to x, when apply removes x, then the call finishes and the next call to x is not-found', async () => {
    const { app } = await live(one({ x: Pod.lazy(gated) }))
    gates = []
    const inFlight = app.call('r', 'x').inc(null)
    await tick()
    expect(await app.apply(one({}))).toEqual(success(undefined))
    openAll()
    expect(await inFlight).toEqual(success(1))
    expect(await app.call('r', 'x').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('given apply adding an eager pod whose factory waits, when it is called meanwhile, then both resolve and the factory ran once', async () => {
    let made = 0, open = () => {}
    const slow = implementation('acme3/slow', { provides: [Counter], make: async () => {
      made++; await new Promise<void>(r => { open = r })
      return [provide(Counter, { inc: async () => success(7) })]
    } })
    const reg = registry(); reg.add(provider('acme3', [slow]))
    const app = ok(await create(one({}), {}, reg))
    const applying = app.apply(one({ s: Pod.eager(slow) }))
    await tick()
    const calling = app.call('r', 's').inc(null)
    await tick()
    open()
    expect(await applying).toEqual(success(undefined))
    expect(await calling).toEqual(success(7))
    expect(made).toBe(1)
  })
  test('given an invalid deployment, when applied, then it fails with the reason and nothing changes', async () => {
    const d = one({ c: Pod.lazy(counter) })
    const { app } = await live(d)
    expect(await app.apply({ pods: {}, runtimes: { r: { pods: ['x'], subscriptions: [] } } })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(app.deployment()).toEqual(d)
  })
  test('given a policy that throws on subscribe, when apply adds a subscription, then it is denied', async () => {
    const policies: Record<string, Policy> = { r: { isAllowed: () => { throw new Error('nope') } } }
    const d = one({ send: Pod.lazy(sender), db: Pod.lazy(kv) })
    const { app } = await live(d, { policies })
    expect(await app.apply(one(d.pods, [{ kind: 'call', from: 'send', to: 'db' }]))).toMatchObject({ ok: false, fail: { type: 'denied' } })
    expect(app.deployment()).toEqual(d)
  })
})

describe('edges of the live application', () => {
  test('given a throwing policy, when the host calls, then it is denied and the stream shows sent then denied', async () => {
    const policies: Record<string, Policy> = { r: { isAllowed: () => { throw new Error('bang') } } }
    const { app, events } = await live(one({ c: Pod.lazy(counter) }), { policies })
    expect(await app.call('r', 'c').inc(null)).toMatchObject({ ok: false, fail: { type: 'denied' } })
    expect(events.map(e => e.type)).toEqual(['sent', 'denied'])
  })
  for (const [name, give] of [['undefined', () => undefined], ['a Promise', async () => ({ approved: true })]] as const)
    test(`given a policy returning ${name}, when the host calls, then it is denied, never a rejection`, async () => {
      const policies = { r: { isAllowed: give } } as unknown as Record<string, Policy>
      const { app } = await live(one({ c: Pod.lazy(counter) }), { policies })
      expect(await app.call('r', 'c').inc(null)).toMatchObject({ ok: false, fail: { type: 'denied', reason: 'policy gave no verdict' } })
    })
  test('given a build that hangs, when called, then it is timeout and a failure event', async () => {
    const hang = implementation('acme3/hang', { provides: [Counter], make: () => new Promise<never>(() => {}) })
    const reg = registry(); reg.add(provider('acme3', [hang]))
    const app = ok(await create(one({ h: Pod.lazy(hang) }), { timeoutMs: 20 }, reg))
    const events: AppEvent[] = []; app.listen(e => events.push(e))
    expect(await app.call('r', 'h').inc(null)).toMatchObject({ ok: false, fail: { type: 'timeout' } })
    expect(events).toContainEqual(expect.objectContaining({ type: 'failure', pod: 'h' }))
  })
  test('given an unknown name, when restarted, then it is not-found', async () => {
    const { app } = await live(one({ c: Pod.lazy(counter) }))
    expect(await app.restart('nope')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('given an eager pod, when restarted, then it is rebuilt at once', async () => {
    const { app, events } = await live(one({ e: Pod.eager(counter) }))
    await app.restart('e')
    expect(events.map(e => e.type)).toEqual(['restarted', 'built'])
  })
  test('given an unknown runtime, when the host calls, then it is not-found', async () => {
    const { app } = await live(one({ c: Pod.lazy(counter) }))
    expect(await app.call('nope', 'c').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
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
      expect(await create(d())).toMatchObject({ ok: false, fail: { type } })
    })
})

describe('final review', () => {
  const tick = () => new Promise(r => setTimeout(r, 0))
  const wired = (): AppDeployment => ({ pods: { send: Pod.lazy(sender), db: Pod.lazy(kv) }, runtimes: { r: { pods: ['send', 'db'], subscriptions: [] } } })
  const sub = { kind: 'call', from: 'send', to: 'db' } as const

  // I1: the application keeps its own copy.
  test('given deployment() mutated in place, when applied under a policy refusing subscribe, then it is denied', async () => {
    const policies: Record<string, Policy> = { r: { isAllowed: (_f, _t, data) => (data === 'subscribe' ? { approved: false, reason: 'frozen' } : { approved: true }) } }
    const { app } = await live(wired(), { policies })
    const d = app.deployment()
    d.runtimes.r!.subscriptions.push(sub)
    expect(await app.apply(d)).toMatchObject({ ok: false, fail: { type: 'denied', reason: 'frozen' } })
    expect(app.deployment()).toEqual(wired())
  })
  test('given the object passed to create, when it is mutated, then nothing changes', async () => {
    const d = wired()
    const { app } = await live(d)
    d.runtimes.r!.subscriptions.push(sub)
    expect(await app.call('r', 'send').send('k')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(app.deployment()).toEqual(wired())
  })
  test('given deployment() mutated without apply, then routing does not change', async () => {
    const { app } = await live(wired())
    const d = app.deployment()
    d.runtimes.r!.subscriptions.push(sub)
    d.runtimes.r!.pods.pop()
    expect(await app.call('r', 'send').send('k')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.call('r', 'db').get('k')).toEqual(success(''))
  })

  // I2: names that are Object.prototype keys are only names.
  test('given a runtime toString and a pod constructor, when called, restarted and applied in and out, then all of it works', async () => {
    const d = { pods: { constructor: Pod.lazy(counter) }, runtimes: { toString: { pods: ['constructor'], subscriptions: [] } }, tags: { constructor: ['x'] } }
    const { app } = await live(d, { policies: {} })
    expect(await app.call('toString', 'constructor').inc(null)).toEqual(success(1))
    expect(await app.restart('constructor')).toEqual(success(undefined))
    expect(await app.call('toString', 'constructor').inc(null)).toEqual(success(1))
    expect(app.deployment()).toEqual({ pods: d.pods, runtimes: d.runtimes })   // runtimes carry no tags
    expect(await app.apply(one({ c: Pod.lazy(counter) }))).toEqual(success(undefined))
    expect(await app.call('toString', 'constructor').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.apply(d)).toEqual(success(undefined))
    expect(app.deployment()).toEqual(d)   // apply carries the tags in
    expect(await app.call('toString', 'constructor').inc(null)).toEqual(success(1))
  })
  test('given a pod __proto__ from JSON, when called, then it answers', async () => {
    const { app } = await live(JSON.parse(JSON.stringify({ runtimes: { r: { pods: ['__proto__'], subscriptions: [] } } }).replace('{', `{"pods":{"__proto__":${JSON.stringify(Pod.lazy(counter))}},`)))
    expect(await app.call('r', '__proto__').inc(null)).toEqual(success(1))
  })
  test('given no such names, when the host calls or restarts them, then each is not-found, never a rejection', async () => {
    const { app } = await live(one({ c: Pod.lazy(counter) }))
    expect(await app.call('constructor', 'c').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.call('r', 'constructor').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.restart('toString')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('given host policies without a toString entry, when runtime toString calls, then the default allows', async () => {
    const { app } = await live({ pods: { c: Pod.lazy(counter) }, runtimes: { toString: { pods: ['c'], subscriptions: [] } } }, { policies: {} })
    expect(await app.call('toString', 'c').inc(null)).toEqual(success(1))
  })

  // M1: one verdict check.
  test('given a policy returning a rejected Promise, when called and applied, then both are denied and nothing is unhandled', async () => {
    const unhandled: unknown[] = [], note = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', note)
    try {
      const policies = { r: { isAllowed: () => Promise.reject(new Error('later')) } } as unknown as Record<string, Policy>
      const { app } = await live(wired(), { policies })
      expect(await app.call('r', 'db').get('k')).toMatchObject({ ok: false, fail: { type: 'denied', reason: 'policy gave no verdict' } })
      expect(await app.apply(one(wired().pods, [sub]))).toMatchObject({ ok: false, fail: { type: 'denied', reason: 'policy gave no verdict' } })
      await tick(); await tick()
      expect(unhandled).toEqual([])
    } finally { process.off('unhandledRejection', note) }
  })
  test('given a verdict whose approved getter throws, when called and applied, then both are denied', async () => {
    const policies = { r: { isAllowed: () => ({ get approved(): boolean { throw new Error('boom') } }) } } as unknown as Record<string, Policy>
    const { app } = await live(wired(), { policies })
    expect(await app.call('r', 'db').get('k')).toMatchObject({ ok: false, fail: { type: 'denied', reason: 'policy threw: boom' } })
    expect(await app.apply(one(wired().pods, [sub]))).toMatchObject({ ok: false, fail: { type: 'denied', reason: 'policy threw: boom' } })
  })

  // M2: a call waiting on a build uses that build's implementation.
  test('given a call waiting on a build, when apply changes the pod, then the call finishes on the old build and the next uses the new', async () => {
    let open = () => {}
    const slow = implementation('acme4/slow', { provides: [Counter], make: async () => {
      await new Promise<void>(r => { open = r }); return [provide(Counter, { inc: async () => success(7) })]
    } })
    const reg = registry(); reg.add(provider('acme4', [slow]))
    const app = ok(await create(one({ x: Pod.lazy(slow) }), {}, reg))
    const calling = app.call('r', 'x').inc(null)
    await tick()
    expect(await app.apply(one({ x: Pod.lazy(kv) }))).toEqual(success(undefined))
    open()
    expect(await calling).toEqual(success(7))
    expect(await app.call('r', 'x').get('k')).toEqual(success(''))
  })

  // M3.
  test('given a rewire-only apply, when an unchanged pod is called again, then it keeps its state', async () => {
    const d = { ...wired(), pods: { ...wired().pods, c: Pod.lazy(counter) }, runtimes: { r: { pods: ['send', 'db', 'c'], subscriptions: [] } } }
    const { app } = await live(d)
    expect(await app.call('r', 'c').inc(null)).toEqual(success(1))
    expect(await app.apply({ ...d, runtimes: { r: { pods: ['send', 'db', 'c'], subscriptions: [sub] } } })).toEqual(success(undefined))
    expect(await app.call('r', 'c').inc(null)).toEqual(success(2))
  })
  test('given a denied apply, then no applied event, and a following allowed apply succeeds', async () => {
    let frozen = true
    const policies: Record<string, Policy> = { r: { isAllowed: () => (frozen ? { approved: false, reason: 'frozen' } : { approved: true }) } }
    const { app, events } = await live(wired(), { policies })
    expect(await app.apply(one(wired().pods, [sub]))).toMatchObject({ ok: false, fail: { type: 'denied' } })
    expect(events.filter(e => e.type === 'applied')).toEqual([])
    frozen = false
    expect(await app.apply(one(wired().pods, [sub]))).toEqual(success(undefined))
    expect(await app.call('r', 'send').send('k')).toEqual(success(null))
    expect(events.filter(e => e.type === 'applied')).toHaveLength(1)
  })
})
