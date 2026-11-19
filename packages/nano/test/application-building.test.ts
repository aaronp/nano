/** Values and a live application (spec: 2026-11-14-values-and-application-design.md); fixtures in fixtures/acme-values.ts. */
import { describe, expect, test } from 'bun:test'
import { Pod, Implementation, provide, Provider, Selector, success } from '../src/index.ts'
import { KV, Send, DB, builds, counter, state, flaky, kv, sender, ticker, db, migrate, careless, gates, openAll, gated, seen, where, registry, ok, create, live, sent, one } from './fixtures/acme-values.ts'

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
    builds.length = 0
    const { app, events } = await live(one({ e: Pod.eager(counter), l: Pod.lazy(counter) }))
    expect(builds).toEqual(['e'])
    await app.call('r', 'l').inc(null)
    expect(builds).toEqual(['e', 'l'])
    expect(events.filter(e => e.type === 'built').map(e => e.pod)).toEqual(['l'])
  })
  // Behaviour 3.
  test('given a lazy pod, when two first calls race, then it is built once', async () => {
    builds.length = 0
    const { app } = await live(one({ c: Pod.lazy(counter) }))
    const [a, b] = await Promise.all([app.call('r', 'c').inc(null), app.call('r', 'c').inc(null)])
    expect(builds).toEqual(['c'])
    expect([ok(a), ok(b)].sort()).toEqual([1, 2])
  })
  // Behaviour 4.
  test('given a factory that throws once, when called twice, then the first call fails threw and the second builds and answers', async () => {
    state.failNext = 1
    const { app, events } = await live(one({ f: Pod.lazy(flaky) }))
    expect(await app.call('r', 'f').inc(null)).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(events).toContainEqual(expect.objectContaining({ type: 'failure', pod: 'f' }))
    expect(await app.call('r', 'f').inc(null)).toEqual(success(1))
  })
  test('given an eager pod whose factory throws, when the application is created, then create succeeds and the pod builds on its first call', async () => {
    state.failNext = 1
    const r = await create(one({ f: Pod.eager(flaky) }))
    expect(r.ok).toBe(true)
    expect(await ok(r).call('r', 'f').inc(null)).toEqual(success(1))
  })
  // Behaviour 5.
  test('given a counter at 2 with a call in flight, when it is restarted, then the next call answers 1 and the call in flight finishes on the old instance', async () => {
    const { app } = await live(one({ g: Pod.lazy(gated) }))
    gates.length = 0
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
  test('given two KVs, one tagged primary, when a pod selects the primary KV, then it reaches that one, straight after assemble and create', async () => {
    const picker = Implementation.define('acme5/picker', { provides: [Send], dependencies: { store: KV }, make: ctx => [provide(Send, {
      send: async msg => { const s = ctx.one(Selector.of(KV, { tags: ['primary'] })); return s.ok ? s.value.call.put(msg) : s },
    })] })
    const reg = registry(); reg.add(Provider.define('acme5', [picker]))
    const calls = [{ kind: 'call', from: 'p', to: 'k1' }, { kind: 'call', from: 'p', to: 'k2' }] as const
    const app = ok(await create({ pods: { p: Pod.lazy(picker), k1: Pod.lazy(kv), k2: Pod.lazy(kv) },
      runtimes: { r: { pods: ['p', 'k1', 'k2'], subscriptions: [...calls] } }, tags: { k2: ['primary'] } }, {}, reg))
    expect(await app.call('r', 'p').send('m')).toEqual(success(null))
    expect([await app.call('r', 'k1').get('m'), await app.call('r', 'k2').get('m')]).toEqual([success(''), success('v')])
  })
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
  test('given a db wired in v2 and in v3, when a pod asks one(DB) without a runtime, then it is not-unique', async () => {
    const { app } = await live({ pods: { m: Pod.lazy(careless), d2: Pod.lazy(db), d3: Pod.lazy(db) }, runtimes: {
      v2: { pods: ['m', 'd2'], subscriptions: [{ kind: 'call', from: 'm', to: 'd2' }] },
      v3: { pods: ['m', 'd3'], subscriptions: [{ kind: 'call', from: 'm', to: 'd3' }] },
    } })
    expect(await app.call('v2', 'm').run(null)).toMatchObject({ ok: false, fail: { type: 'not-unique' } })
  })
})
