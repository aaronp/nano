/** Pods, runtimes and an application (spec: 2026-11-14-pods-runtimes-application-design.md): see fixtures/acme-store.ts. */
import { describe, expect, test } from 'bun:test'
import { Application, Pod, Pods, Runtime, AppDeployment, type RuntimeDeployment } from '../src/index.ts'
import { Counter, counter, store, appImpl, registry, ok, create } from './fixtures/acme-store.ts'

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

describe('a runtime policy as data', () => {
  const d = (policy?: RuntimeDeployment['policy']): AppDeployment => ({ pods: { c: Pod.lazy(counter) }, runtimes: { r: { pods: ['c'], subscriptions: [], ...(policy !== undefined && { policy }) } } })
  const denyCalls: RuntimeDeployment['policy'] = { kind: 'rules', rules: [{ deny: 'call', toInterface: 'acme.Counter' }, { allow: '*' }] }

  test('given rules in a deployment, when the host calls, then they govern it and the deployment round-trips', async () => {
    const { app } = await create(d(denyCalls))
    expect(await app.call('c').inc(null)).toMatchObject({ ok: false, fail: { type: 'denied', reason: 'rules[0]' } })
    expect(app.deployment().runtimes.r!.policy).toEqual(denyCalls)
  })

  test('given no policy or allow-all, when the host calls, then it is allowed', async () => {
    for (const p of [undefined, { kind: 'allow-all' } as const]) expect(await (await create(d(p))).app.call('c').inc(null)).toMatchObject({ ok: true })
  })

  test('given a live app, when apply changes the rules, then the next call and live subscriptions are decided by them', async () => {
    const { app } = await create(d({ kind: 'allow-all' }))
    const seen: unknown[] = []
    app.subscribe(Counter.ops.inc, e => { seen.push(e.output) })
    expect(ok(await app.call('c').inc(null))).toBe(1)
    expect(seen).toEqual([1])
    ok(await app.apply(d({ kind: 'rules', rules: [{ allow: 'call' }] })))
    expect(ok(await app.call('c').inc(null))).toBe(2)
    expect(seen).toEqual([1])   // the subscribe was asked again and refused
    ok(await app.apply(d(denyCalls)))
    expect(await app.call('c').inc(null)).toMatchObject({ ok: false, fail: { type: 'denied' } })
  })

  test('given a code policy and a data policy for one runtime, when create or apply, then invalid-input', async () => {
    const policies = { r: { isAllowed: () => ({ approved: true as const }) } }
    expect(await Application.create(ok(AppDeployment.assemble(d(denyCalls), registry())), { policies })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    const app = ok(await Application.create(ok(AppDeployment.assemble(d(), registry())), { policies }))
    expect(await app.apply(d(denyCalls))).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
})

describe('one apply bringing an edge and its rules', () => {
  const d = (policy: RuntimeDeployment['policy'], edge: boolean): AppDeployment => ({
    pods: { app: Pod.lazy(appImpl), db: Pod.lazy(store, { config: 'one' }) },
    runtimes: { r: { pods: ['app', 'db'], subscriptions: edge ? [{ kind: 'call', from: 'app', to: 'db' }] : [], policy } },
  })
  test('given an apply adding an edge and rules, when it is checked, then the new rules decide it', async () => {
    const start = d({ kind: 'rules', rules: [{ deny: 'call', from: 'app' }, { allow: '*' }] }, false)
    const { app } = await create(start)
    ok(await app.apply(d({ kind: 'rules', rules: [{ allow: '*' }] }, true)))
    const { app: other } = await create(d({ kind: 'allow-all' }, false))
    ok(await other.apply(d({ kind: 'rules', rules: [{ deny: 'call', from: 'app' }, { allow: '*' }] }, true)))   // the edge is accepted; each call along it is policed
  })
})
