// @ts-nocheck — the pods/runtimes/application revision isn't built yet; remove when it lands
/**
 * Pods, runtimes and an application (spec: 2026-11-14-pods-runtimes-application-design.md), written first. Each level
 * has its own deployment: `Pods.create` (descriptions, a scoped lookup), `Runtime.create` (placement and wiring over a
 * scope), `Application.create(runtimes)` (live). Call edges are what a pod's code selects through; pipes carry
 * events and action results; `selection.on` subscribes in code.
 */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import * as nano from '../src/index.ts'

const { Pod, Pods, Runtime, Application, assemble, implementation, provide, provider, createRegistry, defineSchema, iface, op, sel, success, failure } = nano as any

const Str = defineSchema('Str', Type.String())
const Num = defineSchema('Num', Type.Integer())
const Nothing = defineSchema('Nothing', Type.Null())
const Counter = iface('acme.Counter', { inc: op.action('inc', Nothing, Num) })
const Store = iface('acme.Store', { save: op.action('save', Str, Str), saved: op.event('saved', Str) })
const Log = iface('acme.Log', { record: op.action('record', Str, Nothing) })
const App = iface('acme.App', { save: op.action('save', Str, Str) })

let n = 0
const counter = implementation('acme/counter', { provides: [Counter], make: () => { let c = 0; n++; return [provide(Counter, { inc: async () => success(++c) })] } })
/** A store whose name is its config; `save('bad')` fails; every save publishes `saved`. */
const store = implementation('acme/store', { provides: [Store], make: (ctx, name: string) => [provide(Store, { save: async s => {
  if (s === 'bad') return failure('invalid-input', 'bad')
  await ctx.publish(Store.ops.saved, `${name}:${s}`)
  return success(`${name}:${s}`)
} })] })
let logged: string[] = []
const logger = implementation('acme/log', { provides: [Log], make: () => [provide(Log, { record: async s => { logged.push(s); return success(null) } })] })
let slowOpen = () => {}
const slowLogger = implementation('acme/slowlog', { provides: [Log], make: () => [provide(Log, { record: async s => { await new Promise(r => { slowOpen = r }); logged.push(s); return success(null) } })] })
/** Domain-level app: its code saves through whichever Store its call edge points at. */
const appImpl = implementation('acme/app', { provides: [App], dependencies: { store: Store }, make: ctx => [provide(App, {
  save: async s => ctx.one(Store).call.save(s),     // fluent: a failed selection's call resolves to its Fail
})] })
/** Subscribes in code to its store's `saved` events. */
let heard: string[] = []
const watcher = implementation('acme/watcher', { provides: [Log], dependencies: { store: Store }, make: ctx => {
  ctx.one(Store).on(Store.ops.saved, d => { heard.push(d as string) })
  return [provide(Log, { record: async () => success(null) })]
} })

const Check = iface('acme.Check', { check: op.action('check', Str, Str) })
let checks = 0
/** Passes its input on, failing from the third call: the loop ends there. */
const checker = implementation('acme/check', { provides: [Check], make: () => [provide(Check, { check: async s => (++checks >= 3 ? failure('invalid-input', 'enough') : success(s)) })] })
/** Its code asks for a store it isn't wired to. */
const lonely = implementation('acme/lonely', { provides: [App], dependencies: { store: Store }, make: ctx => {
  ctx.one(Store).on(Store.ops.saved, () => { heard.push('never') })
  return [provide(App, { save: async s => ctx.one(Store).call.save(s) })]
} })

/** Counts the stores wired to it that are tagged primary. */
const primaries = implementation('acme/primaries', { provides: [Counter], dependencies: { store: Store }, make: ctx => [provide(Counter, {
  inc: async () => success(ctx.all(sel(Store, { tags: ['primary'] })).length),
})] })

const registry = () => { const r = createRegistry(); r.add(provider('acme', [counter, store, logger, slowLogger, appImpl, watcher, checker, lonely, primaries])); return r }
const ok = r => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const create = async (d, opts = {}) => {
  logged = []; heard = []
  const app = ok(await Application.create(ok(assemble(d, registry())), opts))
  const events = []
  app.listen(e => events.push(e))
  return { app, events }
}
const sent = (events, kind?) => events.filter(e => e.type === 'sent' && (!kind || e.kind === kind)).map(e => `${e.runtime}:${e.from}->${e.to}`)
const tick = () => new Promise(r => setTimeout(r, 0))

describe('assembling', () => {
  // Behaviour 1.
  test('given a pod deployment, when Pods.create runs, then it only checks data: unknown implementation not-found, bad config invalid-input, nothing built', () => {
    n = 0
    expect(ok(Pods.create({ c: Pod.eager(counter) }, { registry: registry() })).names()).toEqual(['c'])
    expect(n).toBe(0)
    expect(Pods.create({ x: { implementation: 'acme/nope', eager: false } }, { registry: registry() })).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  // Behaviour 2.
  test('given pods a, b, c, when a subset is selected, then the lookup is scoped and an unknown name is not-found', () => {
    const pods = ok(Pods.create({ a: Pod.lazy(counter), b: Pod.lazy(counter), c: Pod.lazy(counter) }, { registry: registry() }))
    const sub = ok(pods.select(['a', 'c']))
    expect(sub.names()).toEqual(['a', 'c'])
    expect(sub.get('b')).toBeUndefined()
    expect(sub.get('a')).toEqual(pods.get('a'))
    expect(pods.select(['a', 'zz'])).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  // Behaviour 3.
  test('given a runtime deployment placing a pod outside its scope, when Runtime.create runs, then it is invalid-input and nothing is built', () => {
    n = 0
    const pods = ok(Pods.create({ a: Pod.eager(counter), b: Pod.eager(counter) }, { registry: registry() }))
    expect(Runtime.create('r', { pods: ['a', 'b'], subscriptions: [] }, ok(pods.select(['a'])))).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(ok(Runtime.create('r', { pods: ['a'], subscriptions: [] }, ok(pods.select(['a'])))).id).toBe('r')
    expect(n).toBe(0)
  })
  test('given tags on Pods.create, when runtimes and the application are made from it, then a tag selector matches and deployment() carries the placed pods\' tags', async () => {
    const d = { p: Pod.lazy(primaries), a: Pod.lazy(store, { config: 'a' }), b: Pod.lazy(store, { config: 'b' }), x: Pod.lazy(counter) }
    const pods = ok(Pods.create(d, { registry: registry(), tags: { b: ['primary'], x: ['unplaced'] } }))
    const r = ok(Runtime.create('r', { pods: ['p', 'a', 'b'], subscriptions: [{ kind: 'call', from: 'p', to: 'a' }, { kind: 'call', from: 'p', to: 'b' }] }, ok(pods.select(['p', 'a', 'b']))))
    const app = ok(await Application.create({ r }, {}))
    expect(await app.call('r', 'p').inc(null)).toEqual(success(1))
    expect(app.deployment().tags).toEqual({ b: ['primary'] })
  })
  test('given tags that are not by pod name, or name a pod not in the deployment, when Pods.create runs, then it is invalid-input', () => {
    for (const tags of [{ a: 'x' }, { 'a/b': ['x'] }, { zz: ['x'] }, { constructor: ['x'] }])
      expect(Pods.create({ a: Pod.lazy(counter) }, { registry: registry(), tags })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
})

describe('scope and sharing', () => {
  // Behaviour 4.
  test('given one pod selected into two runtimes, when the application is created, then it is one instance', async () => {
    const pods = ok(Pods.create({ a: Pod.lazy(counter), c: Pod.lazy(counter), d: Pod.lazy(counter) }, { registry: registry() }))
    const chat = ok(Runtime.create('chat', { pods: ['a', 'c'], subscriptions: [] }, ok(pods.select(['a', 'c']))))
    const support = ok(Runtime.create('support', { pods: ['c', 'd'], subscriptions: [] }, ok(pods.select(['c', 'd']))))
    const app = ok(await Application.create({ chat, support }, {}))
    expect(await app.call('chat', 'c').inc(null)).toEqual(success(1))
    expect(await app.call('support', 'c').inc(null)).toEqual(success(2))
  })
  // Behaviour 5.
  test('given a pod outside a runtime, when the host calls it there, then it is not-found', async () => {
    const { app } = await create({ pods: { a: Pod.lazy(counter), d: Pod.lazy(counter) },
      runtimes: { chat: { pods: ['a'], subscriptions: [] }, support: { pods: ['d'], subscriptions: [] } } })
    expect(await app.call('chat', 'd').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  // Behaviour 6. Waits for Task 4: appImpl saves through a Selection (`ctx.one(Store).call`).
  test.todo('given app saving through its call edge to db1, when apply points the edge at db2, then the same code saves to db2', async () => {
    const d = { pods: { app: Pod.lazy(appImpl), db1: Pod.lazy(store, { config: 'one' }), db2: Pod.lazy(store, { config: 'two' }) },
      runtimes: { r: { pods: ['app', 'db1', 'db2'], subscriptions: [{ kind: 'call', from: 'app', to: 'db1' }] } } }
    const { app } = await create(d)
    expect(await app.call('r', 'app').save('x')).toEqual(success('one:x'))
    ok(await app.apply({ ...d, runtimes: { r: { ...d.runtimes.r, subscriptions: [{ kind: 'call', from: 'app', to: 'db2' }] } } }))
    expect(await app.call('r', 'app').save('x')).toEqual(success('two:x'))
  })
})

describe('composing runtimes', () => {
  const root = () => ok(Pods.create({ a: Pod.lazy(counter), b: Pod.lazy(counter), c: Pod.lazy(counter), d: Pod.lazy(counter) }, { registry: registry() }))
  const placing = (pods: nano.Pods, id: string, names: string[]) => ok(Runtime.create(id, { pods: names, subscriptions: [] }, ok(pods.select(names))))
  test('given no runtimes, when the application is created, then it succeeds with an empty deployment', async () => {
    const app = ok(await Application.create({}, {}))
    expect(app.deployment()).toEqual({ pods: {}, runtimes: {} })
  })
  // Review Focus 2.
  test('given two runtimes from different Pods both naming a, when the application is created, then it is invalid-input', async () => {
    const one = ok(Pods.create({ a: Pod.lazy(counter) }, { registry: registry() }))
    const other = ok(Pods.create({ a: Pod.lazy(store, { config: 'x' }) }, { registry: registry() }))
    const r = await Application.create({ x: placing(one, 'x', ['a']), y: placing(other, 'y', ['a']) }, {})
    expect(r).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(r.fail.reason).toBe('runtime y: its pods come from another Pods')
  })
  test('given runtimes from one Pods, when composed, then deployment() has the placed pods in Pods order and the runtimes in the given order', async () => {
    const pods = root()
    const app = ok(await Application.create({ t: placing(pods, 't', ['d']), s: placing(pods, 's', ['c', 'a']) }, {}))
    const d = app.deployment()
    expect(Object.keys(d.pods)).toEqual(['a', 'c', 'd'])
    expect(Object.keys(d.runtimes)).toEqual(['t', 's'])
    expect(d.runtimes.s).toEqual({ pods: ['c', 'a'], subscriptions: [] })
  })
  test('given more than 50 runtimes, a runtime id breaking the id rule, or something not a runtime, then it is invalid-input', async () => {
    const pods = root(), r = placing(pods, 'r', ['a'])
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`r${i}`, r]))
    for (const runtimes of [many, { 'a/b': r }, { r: 3 }, null])
      expect(await Application.create(runtimes, {})).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
  test('given a hand-made runtime, when the application is created, then it is invalid-input', async () => {
    const pods = root(), real = placing(pods, 'r', ['a'])
    const r = await Application.create({ r: { id: 'r', pods: real.pods, deployment: real.deployment } }, {})
    expect(r).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'runtime r: not made by Runtime.create' } })
  })
  test("given a runtime under a key other than its id, when the application is created, then it is invalid-input naming both", async () => {
    const r = await Application.create({ x: placing(root(), 'y', ['a']) }, {})
    expect(r).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'runtime x: its id is y' } })
  })
})

describe('pipes and emissions', () => {
  const piped = (source: string, logPod = 'log') => ({
    pods: { db: Pod.lazy(store, { config: 'db' }), log: Pod.lazy(logger), slow: Pod.lazy(slowLogger) },
    runtimes: { r: { pods: ['db', 'log', 'slow'], subscriptions: [{ kind: 'pipe', from: 'db', source, to: logPod, target: 'acme.Log/record' }] } },
  })
  // Behaviour 7.
  test.todo("given a pipe from db's save action to a logger, when the host saves, then the caller gets its result and the logger gets it as a pipe message; a failed save pipes nothing", async () => {
    const { app, events } = await create(piped('acme.Store/save'))
    expect(await app.call('r', 'db').save('x')).toEqual(success('db:x'))
    await tick()
    expect(logged).toEqual(['db:x'])
    expect(sent(events, 'pipe')).toEqual(['r:db->log'])
    expect(await app.call('r', 'db').save('bad')).toMatchObject({ ok: false })
    await tick()
    expect(logged).toEqual(['db:x'])
  })
  // Behaviour 8.
  test.todo('given a pipe from an event in each of two runtimes, when the pod publishes, then each pipe delivers once, recorded in its runtime', async () => {
    const pipe = { kind: 'pipe', from: 'db', source: 'acme.Store/saved', to: 'log', target: 'acme.Log/record' }
    const { app, events } = await create({ pods: { db: Pod.lazy(store, { config: 'db' }), log: Pod.lazy(logger) },
      runtimes: { a: { pods: ['db', 'log'], subscriptions: [pipe] }, b: { pods: ['db', 'log'], subscriptions: [pipe] } } })
    await app.call('a', 'db').save('x')
    await tick()
    expect(logged).toEqual(['db:x', 'db:x'])
    expect(sent(events, 'pipe')).toEqual(['a:db->log', 'b:db->log'])
  })
  // Behaviour 11.
  test.todo('given a slow pipe target, when the host saves, then the caller does not wait for it', async () => {
    const { app } = await create(piped('acme.Store/save', 'slow'))
    expect(await app.call('r', 'db').save('x')).toEqual(success('db:x'))
    expect(logged).toEqual([])
    slowOpen(); await tick()
    expect(logged).toEqual(['db:x'])
  })
})

describe('subscriptions in code', () => {
  const watched = () => ({ pods: { w: Pod.eager(watcher), db: Pod.lazy(store, { config: 'db' }) },
    runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } })
  // Behaviour 9.
  test.todo("given a watcher whose factory subscribes to its store's saved event, when the store saves, then the watcher hears it as an on message", async () => {
    const { app, events } = await create(watched())
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual(['db:x'])
    expect(sent(events, 'on')).toEqual(['r:db->w'])
  })
  // Behaviour 10.
  test.todo('given a watcher subscribed in code, when it restarts, then its old subscription stops and the new instance subscribes afresh', async () => {
    const { app } = await create(watched())
    await app.restart('w')
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual(['db:x'])   // once: the old instance's subscription stopped
  })
})

describe('selections and chains', () => {
  // Behaviour 14.
  test.todo('given a pod not wired to any store, when its code selects one, then call resolves to not-found and on does nothing', async () => {
    const { app } = await create({ pods: { l: Pod.eager(lonely) }, runtimes: { r: { pods: ['l'], subscriptions: [] } } })
    expect(await app.call('r', 'l').save('x')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(heard).toEqual([])
  })
  // Behaviour 15.
  test.todo('given a pipe cycle a.save → b.check → a.save, when the host saves, then it runs until check fails, each message chained to the host call', async () => {
    checks = 0
    const { app, events } = await create({ pods: { a: Pod.lazy(store, { config: 'a' }), b: Pod.lazy(checker) }, runtimes: { r: { pods: ['a', 'b'], subscriptions: [
      { kind: 'pipe', from: 'a', source: 'acme.Store/save', to: 'b', target: 'acme.Check/check' },
      { kind: 'pipe', from: 'b', source: 'acme.Check/check', to: 'a', target: 'acme.Store/save' },
    ] } } })
    await app.call('r', 'a').save('x')
    for (let i = 0; i < 10; i++) await tick()
    expect(checks).toBe(3)
    const all = events.filter(e => e.type === 'sent'), root = all[0]
    expect(root).toMatchObject({ kind: 'call', from: 'host', correlation: root.id })
    expect(root.cause).toBeUndefined()
    expect(all.slice(1).every(e => e.correlation === root.id && e.kind === 'pipe')).toBe(true)
    expect(all.slice(1).every((e, i) => e.cause === all[i].id)).toBe(true)
  })
})

describe('the application deployment', () => {
  // Behaviour 13.
  const saved = () => ({ pods: { app: Pod.lazy(appImpl), db: Pod.lazy(store, { config: 'db' }) },
    runtimes: { r: { pods: ['app', 'db'], subscriptions: [{ kind: 'call', from: 'app', to: 'db' }] } }, tags: { db: ['primary'] } })
  test('given an assembled application, when its deployment is saved and re-assembled, then it is the same AppDeployment', async () => {
    const first = (await create(saved())).app
    expect(first.deployment()).toEqual(saved())
    const again = (await create(JSON.parse(JSON.stringify(first.deployment())))).app
    expect(again.deployment()).toEqual(first.deployment())
  })
  // Behaviour 13, calls. Waits for Task 4: appImpl saves through a Selection (`ctx.one(Store).call`).
  test.todo('given a saved and re-assembled application, when app saves, then both answer db:x', async () => {
    const first = (await create(saved())).app
    const again = (await create(JSON.parse(JSON.stringify(first.deployment())))).app
    expect(await first.call('r', 'app').save('x')).toEqual(success('db:x'))
    expect(await again.call('r', 'app').save('x')).toEqual(success('db:x'))
  })
})
