/**
 * `app.runtime(id).start(pod)` and `getOrCreate(pod)` (ADR-0031): a pod started explicitly, as a `start` message from
 * the host, policed and traced; `getOrCreate` reuses a running pod and gives `call(pod)`'s client.
 */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import {
  Application, AppDeployment, Implementation, Interface, Op, Pod, Provider, Registry, Schema, failure, provide, success,
  type AppEvent, type NanoResult, type RuntimeDeployment,
} from '../src/index.ts'

const Num = Schema.define(Type.Integer(), 'Num')
const Counter = Interface.define('acme.Counter', { inc: Op.action(Num, Num), ticked: Op.event(Num) })

let breakBuild = false
const counter = Implementation.define('acme/counter', { provides: [Counter], make: async () => {
  if (breakBuild) throw new Error('cannot build')
  await Promise.resolve()
  return [provide(Counter, { inc: async (n: number) => success(n + 1) })]
} })

const ok = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const one = (pods: AppDeployment['pods'], policy?: RuntimeDeployment['policy']): AppDeployment =>
  ({ pods, runtimes: { r: { pods: Object.keys(pods), subscriptions: [], ...(policy && { policy }) } } })
const live = async (d: AppDeployment) => {
  const reg = Registry.create(); reg.add(Provider.define('acme', [counter]))
  return ok(await Application.create(ok(AppDeployment.assemble(d, reg))))
}
const events = (app: Awaited<ReturnType<typeof live>>) => { const all: AppEvent[] = []; app.listen(e => all.push(e)); return all }

describe('start', () => {
  test('builds a lazy pod: built on the stream, not started → running', async () => {
    const app = await live(one({ c: Pod.lazy(counter) })), seen = events(app), r = app.runtime('r')
    expect(r.status('c')).toEqual(success('not started'))
    expect(await r.start('c')).toEqual(success(undefined))
    expect(r.status('c')).toEqual(success('running'))
    expect(seen.map(e => e.type)).toEqual(['sent', 'built', 'delivered'])
    expect(seen[0]).toMatchObject({ type: 'sent', kind: 'start', from: 'host', to: 'c', runtime: 'r' })
    expect(seen[0]).not.toHaveProperty('port')
  })
  test('a running pod → invalid-input "already running"', async () => {
    const r = (await live(one({ c: Pod.eager(counter) }))).runtime('r')
    expect(await r.start('c')).toEqual(failure('invalid-input', 'c is already running'))
  })
  test('a pod not placed in the runtime → not-found', async () => {
    const r = (await live(one({ c: Pod.lazy(counter) }))).runtime('r')
    expect(await r.start('nope')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('after close → not-found, no message', async () => {
    const app = await live(one({ c: Pod.lazy(counter) })), seen = events(app)
    ok(await app.close())
    expect(await app.runtime('r').start('c')).toEqual(failure('not-found', 'application is closed'))
    expect(seen.filter(e => e.type === 'sent')).toEqual([])
  })
  test('a rules policy without allow start → denied, sent then denied', async () => {
    const app = await live(one({ c: Pod.lazy(counter) }, { kind: 'rules', rules: [{ allow: 'call' }] })), seen = events(app)
    expect(await app.runtime('r').start('c')).toMatchObject({ ok: false, fail: { type: 'denied' } })
    expect(seen.map(e => e.type)).toEqual(['sent', 'denied'])
    expect(app.runtime('r').status('c')).toEqual(success('not started'))
  })
  test('a rules policy with allow start → started', async () => {
    const app = await live(one({ c: Pod.lazy(counter) }, { kind: 'rules', rules: [{ allow: 'start' }] }))
    expect(await app.runtime('r').start('c')).toEqual(success(undefined))
  })
  test('a failed pod can be started again', async () => {
    breakBuild = true
    const app = await live(one({ c: Pod.eager(counter) })).finally(() => { breakBuild = false })
    expect(app.runtime('r').status('c')).toEqual(success('failed'))
    ok(await app.runtime('r').start('c'))
    expect(app.runtime('r').status('c')).toEqual(success('running'))
  })
  test("a build that fails → the build's Fail, then failed", async () => {
    const app = await live(one({ c: Pod.lazy(counter) }))
    breakBuild = true
    const r = await app.runtime('r').start('c').finally(() => { breakBuild = false })
    expect(r).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(app.runtime('r').status('c')).toEqual(success('failed'))
  })
})

describe('getOrCreate', () => {
  test('running → started: false; stopped (not started) → started: true', async () => {
    const app = await live(one({ e: Pod.eager(counter), l: Pod.lazy(counter) }))
    expect(ok(await app.runtime('r').getOrCreate('e')).started).toBe(false)
    expect(ok(await app.runtime('r').getOrCreate('l')).started).toBe(true)
    expect(app.runtime('r').status('l')).toEqual(success('running'))
  })
  test('two racing callers: one true, one false, one build', async () => {
    const app = await live(one({ c: Pod.lazy(counter) })), seen = events(app)
    const [a, b] = await Promise.all([app.runtime('r').getOrCreate('c'), app.runtime('r').getOrCreate('c')])
    expect([ok(a).started, ok(b).started].sort()).toEqual([false, true])
    expect(seen.filter(e => e.type === 'built')).toHaveLength(1)
  })
  test("its pod is call(pod)'s client", async () => {
    const app = await live(one({ c: Pod.lazy(counter) }))
    const { pod } = ok(await app.runtime('r').getOrCreate('c'))
    expect(await pod.inc(2)).toEqual(await app.runtime('r').call('c').inc(2))
  })
  test('its failures are start\'s', async () => {
    const app = await live(one({ c: Pod.lazy(counter) }))
    expect(await app.runtime('r').getOrCreate('nope')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
})

test('subscribing to a lazy pod still leaves it not started', async () => {
  const app = await live(one({ c: Pod.lazy(counter) }))
  const off = app.runtime('r').subscribe(Counter.ops.ticked, () => {})
  await Promise.resolve()
  expect(app.runtime('r').status('c')).toEqual(success('not started'))
  off()
})

