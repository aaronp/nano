/** Values and a live application (spec: 2026-11-14-values-and-application-design.md); fixtures in fixtures/acme-values.ts. */
import { describe, expect, test } from 'bun:test'
import { PolicyRules, Pod, AppDeployment, Implementation, Provider, success, type AppEvent, type NanoContext, type Policy } from '../src/index.ts'
import { KV, Ticks, counter, kv, sender, adaptive, ticker, logged, log, db, bad, registry, ok, create, live, sent, one } from './fixtures/acme-values.ts'

describe('messages', () => {
  // Behaviour 10.
  test('given a ticker in two runtimes with a log subscribed in each, when it publishes, then each subscription gets it, recorded in its runtime', async () => {
    logged.length = 0
    let ctxOut: NanoContext | undefined
    const tick = Implementation.define('acme2/tick', { provides: [Ticks], make: ctx => { ctxOut = ctx; return [] } })
    const reg = registry(); reg.add(Provider.define('acme2', [tick]))
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
    const policies: Record<string, Policy> = { r: { isAllowed: ask => ({ approved: false, reason: `no ${ask.to}` }) } }
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
  test('given a policy that refuses calls, when apply adds a call edge, then apply is accepted and each call along it is denied', async () => {
    const policies: Record<string, Policy> = { r: { isAllowed: ask => (ask.kind === 'call' ? { approved: false, reason: 'frozen' } : { approved: true }) } }
    const d = one({ send: Pod.lazy(sender), db: Pod.lazy(kv) })
    const { app } = await live(d, { policies })
    const next: AppDeployment = { ...d, runtimes: { r: { ...d.runtimes.r!, subscriptions: [{ kind: 'call', from: 'send', to: 'db' }] } } }
    expect(await app.apply(next)).toEqual(success(undefined))
    expect(app.deployment()).toEqual(next)
    expect(await app.call('r', 'send').send('k')).toMatchObject({ ok: false, fail: { type: 'denied' } })
  })
  test('given interface rules, when apply adds a call edge, then it is accepted and each call along it is allowed or denied per message', async () => {
    const policies = { r: PolicyRules([{ allow: 'call', from: 'host', toInterface: 'acme.Send' }, { allow: 'call', from: 'send', toPort: 'acme.KV/put' }, { deny: '*' }]) }
    const d = one({ send: Pod.lazy(sender), db: Pod.lazy(kv) })
    const { app } = await live(d, { policies })
    const next: AppDeployment = { ...d, runtimes: { r: { ...d.runtimes.r!, subscriptions: [{ kind: 'call', from: 'send', to: 'db' }] } } }
    expect(await app.apply(next)).toEqual(success(undefined))
    expect(await app.call('r', 'send').send('k')).toEqual(success(null))
    expect(await app.call('r', 'db').get('k')).toMatchObject({ ok: false, fail: { type: 'denied' } })
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
