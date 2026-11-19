/** Values and a live application (spec: 2026-11-14-values-and-application-design.md); fixtures in fixtures/acme-values.ts. */
import { describe, expect, test } from 'bun:test'
import { Pod, AppDeployment, Implementation, provide, Provider, success, type AppEvent, type Policy } from '../src/index.ts'
import { Counter, KV, Send, counter, kv, sender, db, gates, openAll, gated, registry, ok, create, live, sent, one } from './fixtures/acme-values.ts'

describe('changing, at the edges', () => {
  const tick = () => new Promise(r => setTimeout(r, 0))
  test('given a pod holding a client from ctx.one(KV), when apply removes that subscription, then its next send is not-found', async () => {
    const d: AppDeployment = { pods: { send: Pod.lazy(sender), db: Pod.lazy(kv) },
      runtimes: { r: { pods: ['send', 'db'], subscriptions: [{ kind: 'call', from: 'send', to: 'db' }] } } }
    let kept: Record<string, (i: unknown) => Promise<unknown>> | undefined
    const holder = Implementation.define('acme3/holder', { provides: [Send], dependencies: { store: KV }, make: ctx => {
      return [provide(Send, { send: async msg => {
        if (!kept) { const s = ctx.one(KV); if (!s.ok) return s; kept = s.value.call as never }
        return kept!.put(msg) as never
      } })]
    } })
    const reg = registry(); reg.add(Provider.define('acme3', [holder]))
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
      { type: 'applied', caller: 'host', added: ['x'], removed: [], changed: [], rewired: ['r'] },
      { type: 'applied', caller: 'host', added: ['y'], removed: ['x'], changed: [], rewired: ['r'] },
    ])
  })
  test('given a call in flight to x, when apply removes x, then the call finishes and the next call to x is not-found', async () => {
    const { app } = await live(one({ x: Pod.lazy(gated) }))
    gates.length = 0
    const inFlight = app.call('r', 'x').inc(null)
    await tick()
    expect(await app.apply(one({}))).toEqual(success(undefined))
    openAll()
    expect(await inFlight).toEqual(success(1))
    expect(await app.call('r', 'x').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('given apply adding an eager pod whose factory waits, when it is called meanwhile, then both resolve and the factory ran once', async () => {
    let made = 0, open = () => {}
    const slow = Implementation.define('acme3/slow', { provides: [Counter], make: async () => {
      made++; await new Promise<void>(r => { open = r })
      return [provide(Counter, { inc: async () => success(7) })]
    } })
    const reg = registry(); reg.add(Provider.define('acme3', [slow]))
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
    const hang = Implementation.define('acme3/hang', { provides: [Counter], make: () => new Promise<never>(() => {}) })
    const reg = registry(); reg.add(Provider.define('acme3', [hang]))
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
    expect(events.map(e => e.type)).toEqual(['closed', 'restarted', 'built'])
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
