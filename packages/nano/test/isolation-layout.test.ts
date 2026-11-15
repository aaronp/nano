/** A pod's `isolation` and the deployment's `layout`, as data (workspace-restore Task 1), written first. */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import {
  Application, Pod, Pods, assemble, createRegistry, defineSchema, iface, implementation, op, provide, provider, success,
  type AppDeployment, type AppEvent,
} from '../src/index.ts'

const Nothing = defineSchema('Nothing', Type.Null())
const Counter = iface('acme.Counter', { inc: op.action('inc', Nothing, Nothing) })
const counter = implementation('acme/counter', { provides: [Counter], make: () => [provide(Counter, { inc: async () => success(null) })] })
const registry = () => { const r = createRegistry(); r.add(provider('acme', [counter])); return r }
const runtimes = { r: { pods: ['a'], subscriptions: [] } }

describe('Pod.isolation', () => {
  test('given an isolation, then the pod carries it; host and undefined leave it out', () => {
    expect(Pod.lazy(counter, { isolation: 'sandbox' })).toEqual({ implementation: 'acme/counter', eager: false, isolation: 'sandbox' })
    expect(Pod.eager(counter, { isolation: 'isolated-sandbox' })).toMatchObject({ eager: true, isolation: 'isolated-sandbox' })
    expect('isolation' in Pod.lazy(counter, { isolation: 'host' })).toBe(false)
    expect('isolation' in Pod.lazy(counter, { isolation: undefined })).toBe(false)
  })
  test('given an isolation outside the three, then Pods.create is invalid-input; each of the three is ok', () => {
    const make = (isolation: unknown) => Pods.create({ a: { implementation: 'acme/counter', eager: false, isolation } }, { registry: registry() })
    expect(make('iframe')).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    for (const i of ['host', 'sandbox', 'isolated-sandbox']) expect(make(i).ok).toBe(true)
  })
})

describe('AppDeployment.layout', () => {
  const d = (layout: unknown) => ({ pods: { a: Pod.lazy(counter) }, runtimes, layout })
  test('given a plain object, then assemble is ok; a string or an array is invalid-input', () => {
    expect(assemble(d({ dock: { root: null } }), registry()).ok).toBe(true)
    expect(assemble(d('x'), registry())).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(assemble(d([1]), registry())).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
  test('given a layout and an isolation, then deployment() drops the layout and keeps the isolation; changing it is reported by apply', async () => {
    const dep: AppDeployment = { pods: { a: Pod.lazy(counter, { isolation: 'sandbox' }) }, runtimes, layout: { x: 1 } }
    const rts = assemble(dep, registry())
    if (!rts.ok) throw new Error(rts.fail.reason)
    const app = await Application.create(rts.value)
    if (!app.ok) throw new Error(app.fail.reason)
    const events: AppEvent[] = []
    app.value.listen(e => events.push(e))
    const now = app.value.deployment()
    expect('layout' in now).toBe(false)
    expect(now.pods.a).toMatchObject({ isolation: 'sandbox' })
    expect(await app.value.apply({ ...now, pods: { a: Pod.lazy(counter, { isolation: 'isolated-sandbox' }) } })).toMatchObject({ ok: true })
    expect(events).toContainEqual(expect.objectContaining({ type: 'applied', changed: ['a'] }))
  })
})
