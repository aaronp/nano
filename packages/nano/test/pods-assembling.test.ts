/** Pods, runtimes and an application (spec: 2026-11-14-pods-runtimes-application-design.md): see fixtures/acme-store.ts. */
import { describe, expect, test } from 'bun:test'
import { Application, Pod, Pods, Runtime, AppDeployment, success } from '../src/index.ts'
import { state, counter, store, appImpl, primaries, registry, ok, create } from './fixtures/acme-store.ts'

describe('assembling', () => {
  // Behaviour 1.
  test('given a pod deployment, when Pods.create runs, then it only checks data: unknown implementation not-found, bad config invalid-input, nothing built', () => {
    state.n = 0
    expect(ok(Pods.create({ c: Pod.eager(counter) }, { registry: registry() })).names()).toEqual(['c'])
    expect(state.n).toBe(0)
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
    state.n = 0
    const pods = ok(Pods.create({ a: Pod.eager(counter), b: Pod.eager(counter) }, { registry: registry() }))
    expect(Runtime.create('r', { pods: ['a', 'b'], subscriptions: [] }, ok(pods.select(['a'])))).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(ok(Runtime.create('r', { pods: ['a'], subscriptions: [] }, ok(pods.select(['a'])))).id).toBe('r')
    expect(state.n).toBe(0)
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
