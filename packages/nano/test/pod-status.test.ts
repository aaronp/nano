/**
 * `app.runtime(id).status(pod)`: what each pod placed there is now — `running` (built), `not started` (never built,
 * or a lazy pod restarted), `stopped` (closed, not rebuilding) or `failed` (its last build failed); `not-found` if not
 * placed there. A call that throws is not a failed pod.
 */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import {
  Application, AppDeployment, Implementation, Interface, Op, Pod, Provider, Registry, Schema, failure, provide, success,
  type NanoResult,
} from '../src/index.ts'

const Num = Schema.define(Type.Integer(), 'Num')
const Nothing = Schema.define(Type.Null(), 'Nothing')
const Counter = Interface.define('acme.Counter', { inc: Op.action(Nothing, Num) })

let breakBuild = false
/** Run `f` with builds of `counter` failing; the flag is always reset. */
const building = async <T>(f: () => Promise<T>) => { breakBuild = true; try { return await f() } finally { breakBuild = false } }
const counter = Implementation.define('acme/counter', { provides: [Counter], make: () => {
  if (breakBuild) throw new Error('cannot build')
  return [provide(Counter, { inc: async () => success(1) })]
} })
const thrower = Implementation.define('acme/thrower', { provides: [Counter], make: () =>
  [provide(Counter, { inc: async () => { throw new Error('boom') } })] })

const ok = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const one = (pods: AppDeployment['pods']): AppDeployment => ({ pods, runtimes: { r: { pods: Object.keys(pods), subscriptions: [] } } })
const live = async (d: AppDeployment) => {
  const reg = Registry.create(); reg.add(Provider.define('acme', [counter, thrower]))
  return ok(await Application.create(ok(AppDeployment.assemble(d, reg))))
}

describe('a runtime answers each pod status', () => {
  test('lazy: not started until called, then running', async () => {
    const app = await live(one({ c: Pod.lazy(counter) }))
    expect(app.runtime('r').status('c')).toEqual(success('not started'))
    ok(await app.call('r', 'c').inc(null))
    expect(app.runtime('r').status('c')).toEqual(success('running'))
  })
  test('eager: running after create', async () => {
    const app = await live(one({ c: Pod.eager(counter) }))
    expect(app.runtime('r').status('c')).toEqual(success('running'))
  })
  test('a call that throws leaves it running', async () => {
    const app = await live(one({ t: Pod.eager(thrower) }))
    expect((await app.call('r', 't').inc(null)).ok).toBe(false)
    expect(app.runtime('r').status('t')).toEqual(success('running'))
  })
  test('a build that throws: failed; a restart that builds: running', async () => {
    const app = await building(() => live(one({ c: Pod.eager(counter) })))
    expect(app.runtime('r').status('c')).toEqual(success('failed'))
    ok(await app.restart('c'))
    expect(app.runtime('r').status('c')).toEqual(success('running'))
  })
  test('a failed pod an apply changes: running again', async () => {
    const app = await building(() => live(one({ c: Pod.eager(counter) })))
    expect(app.runtime('r').status('c')).toEqual(success('failed'))
    ok(await app.apply(one({ c: Pod.eager(thrower) })))
    expect(app.runtime('r').status('c')).toEqual(success('running'))
  })
  test('restart: lazy → not started; eager → running once rebuilt', async () => {
    const app = await live(one({ l: Pod.lazy(counter), e: Pod.eager(counter) }))
    ok(await app.call('r', 'l').inc(null))
    ok(await app.restart('l'))
    ok(await app.restart('e'))
    expect(app.runtime('r').status('l')).toEqual(success('not started'))
    expect(app.runtime('r').status('e')).toEqual(success('running'))
  })
  test('closed by apply → not-found; placed again → its new state', async () => {
    const app = await live(one({ c: Pod.eager(counter) }))
    ok(await app.apply(one({})))
    expect(app.runtime('r').status('c')).toEqual(failure('not-found', 'c is not placed in r'))
    ok(await app.apply(one({ c: Pod.lazy(counter) })))
    expect(app.runtime('r').status('c')).toEqual(success('not started'))
  })
  test('a pod not placed in that runtime → not-found', async () => {
    const app = await live({ pods: { c: Pod.eager(counter) }, runtimes: { r: { pods: ['c'], subscriptions: [] }, s: { pods: [], subscriptions: [] } } })
    expect(app.runtime('s').status('c')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(app.runtime('nope').status('c')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('after app.close(): stopped', async () => {
    const app = await live(one({ c: Pod.eager(counter) }))
    ok(await app.close())
    expect(app.runtime('r').status('c')).toEqual(success('stopped'))
  })
})
