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
const appImpl = implementation('acme/app', { provides: [App], dependencies: { store: Store }, make: ctx => [provide(App, { save: async s => {
  const st = ctx.one(Store)
  return st.ok ? st.value.call.save(s) : st
} })] })
/** Subscribes in code to its store's `saved` events. */
let heard: string[] = []
const watcher = implementation('acme/watcher', { provides: [Log], dependencies: { store: Store }, make: ctx => {
  const st = ctx.one(Store)
  if (st.ok) st.value.on(Store.ops.saved, d => { heard.push(d as string) })
  return [provide(Log, { record: async () => success(null) })]
} })

const registry = () => { const r = createRegistry(); r.add(provider('acme', [counter, store, logger, slowLogger, appImpl, watcher])); return r }
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
  test.todo('given a pod deployment, when Pods.create runs, then it only checks data: unknown implementation not-found, bad config invalid-input, nothing built', () => {
    n = 0
    expect(ok(Pods.create({ c: Pod.eager(counter) }, { registry: registry() })).names()).toEqual(['c'])
    expect(n).toBe(0)
    expect(Pods.create({ x: { implementation: 'acme/nope', eager: false } }, { registry: registry() })).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  // Behaviour 2.
  test.todo('given pods a, b, c, when a subset is selected, then the lookup is scoped and an unknown name is not-found', () => {
    const pods = ok(Pods.create({ a: Pod.lazy(counter), b: Pod.lazy(counter), c: Pod.lazy(counter) }, { registry: registry() }))
    const sub = ok(pods.select(['a', 'c']))
    expect(sub.names()).toEqual(['a', 'c'])
    expect(sub.get('b')).toBeUndefined()
    expect(sub.get('a')).toEqual(pods.get('a'))
    expect(pods.select(['a', 'zz'])).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  // Behaviour 3.
  test.todo('given a runtime deployment placing a pod outside its scope, when Runtime.create runs, then it is invalid-input and nothing is built', () => {
    n = 0
    const pods = ok(Pods.create({ a: Pod.eager(counter), b: Pod.eager(counter) }, { registry: registry() }))
    expect(Runtime.create('r', { pods: ['a', 'b'], subscriptions: [] }, ok(pods.select(['a'])))).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(ok(Runtime.create('r', { pods: ['a'], subscriptions: [] }, ok(pods.select(['a'])))).id).toBe('r')
    expect(n).toBe(0)
  })
})

describe('scope and sharing', () => {
  // Behaviour 4.
  test.todo('given one pod selected into two runtimes, when the application is created, then it is one instance', async () => {
    const pods = ok(Pods.create({ a: Pod.lazy(counter), c: Pod.lazy(counter), d: Pod.lazy(counter) }, { registry: registry() }))
    const chat = ok(Runtime.create('chat', { pods: ['a', 'c'], subscriptions: [] }, ok(pods.select(['a', 'c']))))
    const support = ok(Runtime.create('support', { pods: ['c', 'd'], subscriptions: [] }, ok(pods.select(['c', 'd']))))
    const app = ok(await Application.create({ chat, support }, {}))
    expect(await app.call('chat', 'c').inc(null)).toEqual(success(1))
    expect(await app.call('support', 'c').inc(null)).toEqual(success(2))
  })
  // Behaviour 5.
  test.todo('given a pod outside a runtime, when the host calls it there, then it is not-found', async () => {
    const { app } = await create({ pods: { a: Pod.lazy(counter), d: Pod.lazy(counter) },
      runtimes: { chat: { pods: ['a'], subscriptions: [] }, support: { pods: ['d'], subscriptions: [] } } })
    expect(await app.call('chat', 'd').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  // Behaviour 6.
  test.todo('given app saving through its call edge to db1, when apply points the edge at db2, then the same code saves to db2', async () => {
    const d = { pods: { app: Pod.lazy(appImpl), db1: Pod.lazy(store, { config: 'one' }), db2: Pod.lazy(store, { config: 'two' }) },
      runtimes: { r: { pods: ['app', 'db1', 'db2'], subscriptions: [{ kind: 'call', from: 'app', to: 'db1' }] } } }
    const { app } = await create(d)
    expect(await app.call('r', 'app').save('x')).toEqual(success('one:x'))
    ok(await app.apply({ ...d, runtimes: { r: { ...d.runtimes.r, subscriptions: [{ kind: 'call', from: 'app', to: 'db2' }] } } }))
    expect(await app.call('r', 'app').save('x')).toEqual(success('two:x'))
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

describe('the application deployment', () => {
  // Behaviour 13.
  test.todo('given an assembled application, when its deployment is saved and re-assembled, then it is the same AppDeployment and answers the same', async () => {
    const d = { pods: { app: Pod.lazy(appImpl), db: Pod.lazy(store, { config: 'db' }) },
      runtimes: { r: { pods: ['app', 'db'], subscriptions: [{ kind: 'call', from: 'app', to: 'db' }] } } }
    const first = (await create(d)).app
    expect(first.deployment()).toEqual(d)
    const again = (await create(JSON.parse(JSON.stringify(first.deployment())))).app
    expect(await again.call('r', 'app').save('x')).toEqual(await first.call('r', 'app').save('x'))
  })
})
