/**
 * Pods, runtimes and an application (spec: 2026-11-14-pods-runtimes-application-design.md), written first. Each level
 * has its own deployment: `Pods.create` (descriptions, a scoped lookup), `Runtime.create` (placement and wiring over a
 * scope), `Application.create(runtimes)` (live). Call edges are what a pod's code selects through; pipes carry
 * events and action results; `selection.on` subscribes in code.
 */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import {
  Application,
  Pod,
  Pods,
  Runtime,
  AppDeployment,
  Registry,
  Schema,
  failure,
  Interface,
  Implementation,
  Op,
  provide,
  Provider,
  Selector,
  success,
  type AppEvent,
  type NanoResult,
  type Selection,
} from '../src/index.ts'

const Str = Schema.define(Type.String(), 'Str')
const Num = Schema.define(Type.Integer(), 'Num')
const Nothing = Schema.define(Type.Null(), 'Nothing')
const Counter = Interface.define('acme.Counter', { inc: Op.action(Nothing, Num) })
const Store = Interface.define('acme.Store', { save: Op.action(Str, Str), saved: Op.event(Str) })
const Log = Interface.define('acme.Log', { record: Op.action(Str, Nothing) })
const App = Interface.define('acme.App', { save: Op.action(Str, Str) })

let n = 0
const counter = Implementation.define('acme/counter', { provides: [Counter], make: () => { let c = 0; n++; return [provide(Counter, { inc: async () => success(++c) })] } })
/** A store whose name is its config; `save('bad')` fails; every save publishes `saved`. */
const store = Implementation.define('acme/store', { provides: [Store], make: (ctx, name: string) => [provide(Store, { save: async s => {
  if (s === 'bad') return failure('invalid-input', 'bad')
  await ctx.publish(Store.ops.saved, `${name}:${s}`)
  return success(`${name}:${s}`)
} })] })
let logged: string[] = []
const logger = Implementation.define('acme/log', { provides: [Log], make: () => [provide(Log, { record: async s => { logged.push(s); return success(null) } })] })
let slowOpen: (v?: unknown) => void = () => {}
const slowLogger = Implementation.define('acme/slowlog', { provides: [Log], make: () => [provide(Log, { record: async s => { await new Promise(r => { slowOpen = r }); logged.push(s); return success(null) } })] })
/** Domain-level app: its code saves through whichever Store its call edge points at. */
const appImpl = Implementation.define('acme/app', { provides: [App], dependencies: { store: Store }, make: ctx => [provide(App, {
  save: async s => { const st = ctx.one(Store); return st.ok ? st.value.call.save(s) : st },   // a failed selection is its Fail
})] })
/** Subscribes in code to its store's `saved` events. */
let heard: string[] = []
const watcher = Implementation.define('acme/watcher', { provides: [Log], dependencies: { store: Store }, make: ctx => {
  const st = ctx.one(Store)
  if (st.ok) st.value.on(Store.ops.saved, d => { heard.push(d) })
  return [provide(Log, { record: async () => success(null) })]
} })

const Check = Interface.define('acme.Check', { check: Op.action(Str, Str) })
let checks = 0
/** Passes its input on, failing from the third call: the loop ends there. */
const checker = Implementation.define('acme/check', { provides: [Check], make: () => [provide(Check, { check: async s => (++checks >= 3 ? failure('invalid-input', 'enough') : success(s)) })] })
/** Its code asks for a store it isn't wired to. */
const lonely = Implementation.define('acme/lonely', { provides: [App], dependencies: { store: Store }, make: ctx => {
  const st = ctx.one(Store)
  if (st.ok) st.value.on(Store.ops.saved, () => { heard.push('never') })
  return [provide(App, { save: async s => { const st = ctx.one(Store); return st.ok ? st.value.call.save(s) : st } })]
} })

/** Counts the stores wired to it that are tagged primary. */
const primaries = Implementation.define('acme/primaries', { provides: [Counter], dependencies: { store: Store }, make: ctx => [provide(Counter, {
  inc: async () => success(ctx.all(Selector.of(Store, { tags: ['primary'] })).length),
})] })

const registry = () => { const r = Registry.create(); r.add(Provider.define('acme', [counter, store, logger, slowLogger, appImpl, watcher, checker, lonely, primaries])); return r }
const ok = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
type Sent = Extract<AppEvent, { type: 'sent' }>
const isSent = (e: AppEvent): e is Sent => e.type === 'sent'
/** `d` assembled and made live, with everything on its stream. */
const create = async (d: unknown, reg = registry()) => {
  logged = []; heard = []
  const app = ok(await Application.create(ok(AppDeployment.assemble(d, reg)), {}))
  const events: AppEvent[] = []
  app.listen(e => events.push(e))
  return { app, events }
}
const sent = (events: AppEvent[], kind?: Sent['kind']) => events.filter(isSent).filter(e => !kind || e.kind === kind).map(e => `${e.runtime}:${e.from}->${e.to}`)
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
  test('given a runtime over a scope wider than it places, with a tag on an unplaced pod, when the application is made, then deployment() has no tag for it and re-assembles', async () => {
    const pods = ok(Pods.create({ a: Pod.lazy(counter), b: Pod.lazy(counter) }, { registry: registry(), tags: { a: ['x'], b: ['y'] } }))
    const app = ok(await Application.create({ r: ok(Runtime.create('r', { pods: ['a'], subscriptions: [] }, pods)) }, {}))
    expect(app.deployment().tags).toEqual({ a: ['x'] })
    expect(AppDeployment.assemble(app.deployment(), registry()).ok).toBe(true)
  })
  test('given tags that are not by pod name, or name a pod not in the deployment, when Pods.create runs, then it is invalid-input', () => {
    for (const tags of [{ a: 'x' }, { 'a/b': ['x'] }, { zz: ['x'] }, { constructor: ['x'] }])
      expect(Pods.create({ a: Pod.lazy(counter) }, { registry: registry(), tags: tags as never })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
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
  // Behaviour 6.
  test('given app saving through its call edge to db1, when apply points the edge at db2, then the same code saves to db2', async () => {
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
  const placing = (pods: Pods, id: string, names: string[]) => ok(Runtime.create(id, { pods: names, subscriptions: [] }, ok(pods.select(names))))
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
    expect(!r.ok && r.fail.reason).toBe('runtime y: its pods come from another Pods')
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
      expect(await Application.create(runtimes as never, {})).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
  test('given a hand-made runtime, when the application is created, then it is invalid-input', async () => {
    const pods = root(), real = placing(pods, 'r', ['a'])
    const r = await Application.create({ r: { id: 'r', pods: real.pods, deployment: real.deployment } }, {})
    expect(r).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'runtime r: not made by Runtime.create' } })
  })
  test('given the package, when its names are listed, then the internal isRuntime and RuntimeIds are not among them', async () => {
    const names = Object.keys(await import('../src/index.ts'))
    expect(names.filter(n => n === 'isRuntime' || n === 'RuntimeIds')).toEqual([])
  })
  test('given runtimes and no opts, when the application is created, then it succeeds', async () => {
    expect(await Application.create({})).toMatchObject({ ok: true })
  })
  test("given a runtime under a key other than its id, when the application is created, then it is invalid-input naming both", async () => {
    const r = await Application.create({ x: placing(root(), 'y', ['a']) }, {})
    expect(r).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'runtime x: its id is y' } })
  })
})

describe('pipes and emissions', () => {
  const piped = (source: string, logPod = 'log'): AppDeployment => ({
    pods: { db: Pod.lazy(store, { config: 'db' }), log: Pod.lazy(logger), slow: Pod.lazy(slowLogger) },
    runtimes: { r: { pods: ['db', 'log', 'slow'], subscriptions: [{ kind: 'pipe', from: 'db', source, to: logPod, target: 'acme.Log/record' }] } },
  })
  // Behaviour 7.
  test("given a pipe from db's save action to a logger, when the host saves, then the caller gets its result and the logger gets it as a pipe message; a failed save pipes nothing", async () => {
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
  test('given a pipe from an event in each of two runtimes, when the pod publishes, then each pipe delivers once, recorded in its runtime', async () => {
    const pipe = { kind: 'pipe', from: 'db', source: 'acme.Store/saved', to: 'log', target: 'acme.Log/record' }
    const { app, events } = await create({ pods: { db: Pod.lazy(store, { config: 'db' }), log: Pod.lazy(logger) },
      runtimes: { a: { pods: ['db', 'log'], subscriptions: [pipe] }, b: { pods: ['db', 'log'], subscriptions: [pipe] } } })
    await app.call('a', 'db').save('x')
    await tick()
    expect(logged).toEqual(['db:x', 'db:x'])
    expect(sent(events, 'pipe')).toEqual(['a:db->log', 'b:db->log'])
  })
  // Behaviour 11.
  test('given a slow pipe target, when the host saves, then the caller does not wait for it', async () => {
    const { app } = await create(piped('acme.Store/save', 'slow'))
    expect(await app.call('r', 'db').save('x')).toEqual(success('db:x'))
    await tick()   // the slow target is now waiting (its handler has started)
    expect(logged).toEqual([])
    slowOpen(); await tick()
    expect(logged).toEqual(['db:x'])
  })
  // Review Focus 5.
  test('given a pipe delivery in flight, when the application closes, then the delivery settles and the emission of its result is not delivered', async () => {
    const d = piped('acme.Store/save', 'slow')
    d.pods.c = Pod.lazy(counter)
    d.runtimes.r!.pods.push('c')
    d.runtimes.r!.subscriptions.push({ kind: 'pipe', from: 'slow', source: 'acme.Log/record', to: 'c', target: 'acme.Counter/inc' })
    const { app, events } = await create(d)
    expect(await app.call('r', 'db').save('x')).toEqual(success('db:x'))
    for (let i = 0; i < 5; i++) await tick()
    const pipe = events.filter(isSent).find(e => e.kind === 'pipe')!
    // The delivery finishes only after every pod has closed, so close() resolves after it only if it waits for it.
    const order: string[] = []
    app.listen(e => {
      if (e.type === 'closed' && e.pod === 'slow') setTimeout(() => slowOpen(), 5)
      if (e.type === 'delivered' && e.id === pipe.id) order.push('delivered')
    })
    expect(await app.close().then(r => { order.push('closed'); return r })).toEqual(success(undefined))
    expect(order).toEqual(['delivered', 'closed'])
    expect(logged).toEqual(['db:x'])
    expect(events).toContainEqual(expect.objectContaining({ type: 'delivered', id: pipe.id, result: success(null) }))
    expect(sent(events)).toEqual(['r:host->db', 'r:db->slow'])
  })
})

describe('subscriptions in code', () => {
  const watched = (): AppDeployment => ({ pods: { w: Pod.eager(watcher), db: Pod.lazy(store, { config: 'db' }) },
    runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } })
  // Behaviour 9.
  test("given a watcher whose factory subscribes to its store's saved event, when the store saves, then the watcher hears it as an on message", async () => {
    const { app, events } = await create(watched())
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual(['db:x'])
    expect(sent(events, 'on')).toEqual(['r:db->w'])
  })
  // Behaviour 10.
  test('given a watcher subscribed in code, when it restarts, then its old subscription stops and the new instance subscribes afresh', async () => {
    const { app } = await create(watched())
    await app.restart('w')
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual(['db:x'])   // once: the old instance's subscription stopped
  })
  test('given a watcher subscribed in code, when the function on returned is called, then it stops hearing', async () => {
    let off = () => {}
    const quitter = Implementation.define('acme2/quitter', { provides: [Log], make: ctx => {
      off = ok(ctx.one(Store)).on(Store.ops.saved, d => { heard.push(d) })
      return [provide(Log, { record: async () => success(null) })]
    } })
    const reg = registry(); reg.add(Provider.define('acme2', [quitter]))
    const { app } = await create({ pods: { w: Pod.eager(quitter), db: Pod.lazy(store, { config: 'db' }) },
      runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } }, reg)
    await app.call('r', 'db').save('x'); await tick()
    off()
    await app.call('r', 'db').save('y'); await tick()
    expect(heard).toEqual(['db:x'])
  })
  // Review Focus 4.
  test('given a watcher subscribed through its call edge, when apply removes that edge, then a later emission does not reach it', async () => {
    const d = watched()
    const { app, events } = await create(d)
    ok(await app.apply({ ...d, runtimes: { r: { ...d.runtimes.r, subscriptions: [] } } }))
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual([])
    expect(sent(events, 'on')).toEqual([])
  })
  test('given a watcher subscribed through its call edge, when apply removes that edge and a later apply restores it, then the old subscription stays dropped', async () => {
    const d = watched()
    const { app, events } = await create(d)
    ok(await app.apply({ ...d, runtimes: { r: { ...d.runtimes.r, subscriptions: [] } } }))
    ok(await app.apply(d))
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual([])
    expect(sent(events, 'on')).toEqual([])
  })
  test('given a selection kept past the removal of its edge, when on is called and the edge is then restored, then it hears nothing', async () => {
    let kept: Selection<typeof Store> | undefined
    const keeper = Implementation.define('acme2/keeper', { provides: [Log], make: ctx => { kept = ok(ctx.one(Store)); return [provide(Log, { record: async () => success(null) })] } })
    const reg = registry(); reg.add(Provider.define('acme2', [keeper]))
    const d: AppDeployment = { pods: { w: Pod.eager(keeper), db: Pod.lazy(store, { config: 'db' }) },
      runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } }
    const { app, events } = await create(d, reg)
    ok(await app.apply({ ...d, runtimes: { r: { ...d.runtimes.r!, subscriptions: [] } } }))
    kept!.on(Store.ops.save, () => { heard.push('late') })
    ok(await app.apply(d))
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual([])
    expect(sent(events, 'on')).toEqual([])
  })
  test('given a watcher whose on callback throws, when the store saves, then it is a failure on the stream and the caller still gets its result', async () => {
    const thrower = Implementation.define('acme2/thrower', { provides: [Log], make: ctx => {
      ok(ctx.one(Store)).on(Store.ops.save, () => { throw new Error('boom') })
      return [provide(Log, { record: async () => success(null) })]
    } })
    const reg = registry(); reg.add(Provider.define('acme2', [thrower]))
    const { app, events } = await create({ pods: { w: Pod.eager(thrower), db: Pod.lazy(store, { config: 'db' }) },
      runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } }, reg)
    expect(await app.call('r', 'db').save('x')).toEqual(success('db:x'))
    await tick()
    expect(sent(events, 'on')).toEqual(['r:db->w'])
    expect(events).toContainEqual(expect.objectContaining({ type: 'failure', pod: 'w' }))
  })
  test("given a store publishing data that breaks its event's schema, when it saves, then it is a failure on the stream and no pipe or on delivers it", async () => {
    const liar = Implementation.define('acme2/liar', { provides: [Store], make: ctx => [provide(Store, { save: async s => {
      await ctx.publish(Store.ops.saved, 42 as unknown as string)   // breaks the schema on purpose
      return success(s)
    } })] })
    const reg = registry(); reg.add(Provider.define('acme2', [liar]))
    const { app, events } = await create({ pods: { w: Pod.eager(watcher), db: Pod.lazy(liar), log: Pod.lazy(logger) },
      runtimes: { r: { pods: ['w', 'db', 'log'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' },
        { kind: 'pipe', from: 'db', source: 'acme.Store/saved', to: 'log', target: 'acme.Log/record' }] } } }, reg)
    expect(await app.call('r', 'db').save('x')).toEqual(success('x'))
    await tick()
    expect([heard, logged]).toEqual([[], []])
    expect(sent(events)).toEqual(['r:host->db'])
    expect(events).toContainEqual(expect.objectContaining({ type: 'failure', pod: 'db' }))
  })
})

describe('selections and chains', () => {
  test("given a host call, when it is sent, then it is a call starting its own chain: correlation is its id, no cause", async () => {
    const { app, events } = await create({ pods: { c: Pod.lazy(counter) }, runtimes: { r: { pods: ['c'], subscriptions: [] } } })
    await app.call('r', 'c').inc(null)
    const [e] = events.filter(isSent) as [Sent]
    expect(e).toMatchObject({ kind: 'call', from: 'host', to: 'c', correlation: e.id })
    expect('cause' in e).toBe(false)
  })
  test('given a pod wired to two stores, when its code selects one, then it is ambiguous, and all gives both in deployment order', async () => {
    let one: NanoResult<Selection<typeof Store>> | undefined, all: Selection<typeof Store>[] = []
    const picker = Implementation.define('acme2/picker', { provides: [Log], make: ctx => { one = ctx.one(Store); all = ctx.all(Store); return [provide(Log, { record: async () => success(null) })] } })
    const reg = registry(); reg.add(Provider.define('acme2', [picker]))
    await create({ pods: { p: Pod.eager(picker), a: Pod.lazy(store, { config: 'a' }), b: Pod.lazy(store, { config: 'b' }) },
      runtimes: { r: { pods: ['p', 'a', 'b'], subscriptions: [{ kind: 'call', from: 'p', to: 'b' }, { kind: 'call', from: 'p', to: 'a' }] } } }, reg)
    expect(one).toMatchObject({ ok: false, fail: { type: 'ambiguous' } })
    expect(all.map(s => [s.pod, s.runtime])).toEqual([['b', 'r'], ['a', 'r']])
    expect(await all[1]!.call.save('x')).toEqual(success('a:x'))
  })
  test('given an event piped twice and heard by one on, when it is published, then all three deliveries are one chain: the first delivery\'s id, no cause', async () => {
    const pipe = (to: string) => ({ kind: 'pipe', from: 'db', source: 'acme.Store/saved', to, target: 'acme.Log/record' }) as const
    const { app, events } = await create({ pods: { w: Pod.eager(watcher), db: Pod.lazy(store, { config: 'db' }), l1: Pod.lazy(logger), l2: Pod.lazy(logger) },
      runtimes: { r: { pods: ['w', 'db', 'l1', 'l2'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }, pipe('l1'), pipe('l2')] } } })
    await app.call('r', 'db').save('x')
    await tick()
    const saved = events.filter(isSent).filter(e => e.kind !== 'call')
    expect(saved.map(e => `${e.kind}:${e.to}`)).toEqual(['pipe:l1', 'pipe:l2', 'on:w'])
    expect(saved.every(e => e.correlation === saved[0]!.id && !('cause' in e))).toBe(true)
  })
  test("given an on subscription to an action's results, when the host calls it, then the on delivery is caused by that call, in its chain", async () => {
    const results = Implementation.define('acme2/results', { provides: [Log], make: ctx => {
      ok(ctx.one(Store)).on(Store.ops.save, d => { heard.push(d) })
      return [provide(Log, { record: async () => success(null) })]
    } })
    const reg = registry(); reg.add(Provider.define('acme2', [results]))
    const { app, events } = await create({ pods: { w: Pod.eager(results), db: Pod.lazy(store, { config: 'db' }) },
      runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } }, reg)
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual(['db:x'])
    const [call, on] = [events.filter(isSent).find(e => e.kind === 'call')!, events.filter(isSent).find(e => e.kind === 'on')!]
    expect(on).toMatchObject({ from: 'db', to: 'w', port: 'acme.Store/save', correlation: call.id, cause: call.id })
  })
  test('given on with an op the selected pod lacks, when it subscribes, then there is one warning and fn is never called', async () => {
    const wrong = Implementation.define('acme2/wrong', { provides: [Log], make: ctx => {
      ok(ctx.one(Store)).on(Log.ops.record as never, () => { heard.push('never') })   // not an op of Store
      return [provide(Log, { record: async () => success(null) })]
    } })
    const reg = registry(); reg.add(Provider.define('acme2', [wrong]))
    const { app, events } = await create({ pods: { w: Pod.lazy(wrong), db: Pod.lazy(store, { config: 'db' }) },
      runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } }, reg)
    expect(await app.call('r', 'w').record('a')).toEqual(success(null))   // builds w, which subscribes
    await app.call('r', 'db').save('x')
    await tick()
    expect(events.filter(e => e.type === 'warning')).toHaveLength(1)
    expect(heard).toEqual([])
  })
  test('given a selection kept past its build, when on is called after that build closed, then it is a no-op', async () => {
    let kept: Selection<typeof Store> | undefined
    const keeper = Implementation.define('acme2/keeper', { provides: [Log], make: ctx => { kept ??= ok(ctx.one(Store)); return [provide(Log, { record: async () => success(null) })] } })
    const reg = registry(); reg.add(Provider.define('acme2', [keeper]))
    const { app, events } = await create({ pods: { w: Pod.eager(keeper), db: Pod.lazy(store, { config: 'db' }) },
      runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } }, reg)
    await app.restart('w')
    const off = kept!.on(Store.ops.save, () => { heard.push('late') })
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual([])
    expect(sent(events, 'on')).toEqual([])
    off()
  })
  // Behaviour 14.
  test('given a pod not wired to any store, when its code selects one, then one is not-found: its call is not made and on is not reached', async () => {
    const { app, events } = await create({ pods: { l: Pod.eager(lonely), db: Pod.lazy(store, { config: 'db' }) }, runtimes: { r: { pods: ['l', 'db'], subscriptions: [] } } })
    expect(await app.call('r', 'l').save('x')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.call('r', 'db').save('y')).toEqual(success('db:y'))   // db does emit saved
    await tick()
    expect(heard).toEqual([])
    expect(sent(events, 'on')).toEqual([])
  })
  // Behaviour 15.
  test('given a pipe cycle a.save → b.check → a.save, when the host saves, then it runs until check fails, each message chained to the host call', async () => {
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
  const saved = (): AppDeployment => ({ pods: { app: Pod.lazy(appImpl), db: Pod.lazy(store, { config: 'db' }) },
    runtimes: { r: { pods: ['app', 'db'], subscriptions: [{ kind: 'call', from: 'app', to: 'db' }] } }, tags: { db: ['primary'] } })
  test('given an assembled application, when its deployment is saved and re-assembled, then it is the same AppDeployment', async () => {
    const first = (await create(saved())).app
    expect(first.deployment()).toEqual(saved())
    const again = (await create(JSON.parse(JSON.stringify(first.deployment())))).app
    expect(again.deployment()).toEqual(first.deployment())
  })
  // Behaviour 13, calls.
  test('given a saved and re-assembled application, when app saves, then both answer db:x', async () => {
    const first = (await create(saved())).app
    const again = (await create(JSON.parse(JSON.stringify(first.deployment())))).app
    expect(await first.call('r', 'app').save('x')).toEqual(success('db:x'))
    expect(await again.call('r', 'app').save('x')).toEqual(success('db:x'))
  })
})

describe('nothing throws', () => {
  test('given a host call whose input has a throwing getter, when it is sent, then it resolves to a Fail', async () => {
    const Rec = Schema.define(Type.Object({ x: Type.String() }), 'Rec')
    const Take = Interface.define('acme.Take', { take: Op.action(Rec, Nothing) })
    const taker = Implementation.define('acme2/taker', { provides: [Take], make: () => [provide(Take, { take: async () => success(null) })] })
    const reg = registry(); reg.add(Provider.define('acme2', [taker]))
    const { app } = await create({ pods: { t: Pod.lazy(taker) }, runtimes: { r: { pods: ['t'], subscriptions: [] } } }, reg)
    const input = { get x(): string { throw new Error('getter') } }
    expect(await app.call('r', 't').take(input)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
  test('given undefined for an op or a selector (a typo in plain JS), when a pod uses it, then on and publish warn, one fails and all is empty', async () => {
    const seen: unknown[] = []
    const sloppy = Implementation.define('acme2/sloppy', { provides: [Log], make: async ctx => {
      const none = undefined as never
      ok(ctx.one(Store)).on(none, () => { heard.push('never') })
      await ctx.publish(none, 1 as never)
      seen.push(ctx.one(none), ctx.all(none))
      return [provide(Log, { record: async () => success(null) })]
    } })
    const reg = registry(); reg.add(Provider.define('acme2', [sloppy]))
    const { app, events } = await create({ pods: { w: Pod.lazy(sloppy), db: Pod.lazy(store, { config: 'db' }) },
      runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } }, reg)
    expect(await app.call('r', 'w').record('a')).toEqual(success(null))
    expect(events.filter(e => e.type === 'warning')).toHaveLength(2)
    expect(seen).toMatchObject([{ ok: false, fail: { type: 'not-found' } }, []])
  })
})

describe('policed emissions', () => {
  /** db piped to log and watched by w, in runtime r, whose policy refuses anything from db to `refused`. */
  const policed = async (refused: string) => {
    logged = []; heard = []
    const d: AppDeployment = { pods: { w: Pod.eager(watcher), db: Pod.lazy(store, { config: 'db' }), log: Pod.lazy(logger) },
      runtimes: { r: { pods: ['w', 'db', 'log'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' },
        { kind: 'pipe', from: 'db', source: 'acme.Store/save', to: 'log', target: 'acme.Log/record' }] } } }
    const policies = { r: { isAllowed: (from: string, to: string) => from === 'db' && to === refused ? { approved: false as const, reason: 'no' } : { approved: true as const } } }
    const app = ok(await Application.create(ok(AppDeployment.assemble(d, registry())), { policies }))
    const events: AppEvent[] = []
    app.listen(e => events.push(e))
    return { app, events }
  }
  test('given a policy refusing db→log, when the host saves, then the pipe delivery is denied and the caller still gets its result', async () => {
    const { app, events } = await policed('log')
    expect(await app.call('r', 'db').save('x')).toEqual(success('db:x'))
    await tick()
    expect(logged).toEqual([])
    const pipe = events.filter(isSent).find(e => e.kind === 'pipe')!
    expect(events).toContainEqual({ type: 'denied', id: pipe.id, reason: 'no' })
    expect(heard).toEqual(['db:x'])
  })
  test('given a policy refusing db→w, when the host saves, then the on delivery is denied and the caller still gets its result', async () => {
    const { app, events } = await policed('w')
    expect(await app.call('r', 'db').save('x')).toEqual(success('db:x'))
    await tick()
    expect(heard).toEqual([])
    const on = events.filter(isSent).find(e => e.kind === 'on')!
    expect(events).toContainEqual({ type: 'denied', id: on.id, reason: 'no' })
    expect(logged).toEqual(['db:x'])
  })
})
