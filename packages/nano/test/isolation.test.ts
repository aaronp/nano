/** `Application.create(…, { isolate })`: the host's stand-in for a pod whose isolation isn't 'host' (workspace-restore Task 2), written first. */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import {
  Application, Pod, assemble, createRegistry, defineSchema, iface, implementation, op, provide, provider, success,
  type AppDeployment, type Implementation,
} from '../src/index.ts'

const Nothing = defineSchema('Nothing', Type.Null())
const Who = defineSchema('Who', Type.String())
const Counter = iface('acme.Counter', { inc: op.action('inc', Nothing, Who) })
const counter = implementation('acme/counter', { provides: [Counter], make: () => [provide(Counter, { inc: async () => success('host') })] })
let closedStandIn = 0
const standIn = implementation('acme/counter', { provides: [Counter], make: ctx => {
  ctx.addOnCloseListener(() => { closedStandIn++ })
  return [provide(Counter, { inc: async () => success('stand-in') })]
} })
const other = implementation('acme/other', { provides: [Counter], make: () => [provide(Counter, { inc: async () => success('other') })] })
const registry = createRegistry()
registry.add(provider('acme', [counter]))

const dep = (c: AppDeployment['pods'][string]): AppDeployment => ({ pods: { c, h: Pod.lazy(counter) }, runtimes: { r: { pods: ['c', 'h'], subscriptions: [] } } })
async function app(d: AppDeployment, isolate?: (name: string, pod: Pod) => Implementation) {
  const rts = assemble(d, registry)
  if (!rts.ok) throw new Error(rts.fail.reason)
  const a = await Application.create(rts.value, isolate ? { isolate } : {})
  if (!a.ok) throw new Error(a.fail.reason)
  return a.value
}

describe('Application.create isolate', () => {
  test('given a sandbox pod, then isolate is called once with its name and pod, and its stand-in serves the call', async () => {
    const seen: [string, Pod][] = []
    const a = await app(dep(Pod.lazy(counter, { isolation: 'sandbox' })), (n, p) => { seen.push([n, p]); return standIn })
    expect(await a.call('r', 'c').inc!(null)).toEqual({ ok: true, value: 'stand-in' })
    await a.call('r', 'c').inc!(null)
    expect(seen).toEqual([['c', { implementation: 'acme/counter', eager: false, isolation: 'sandbox' }]])
  })
  test('given host pods, then isolate is never called', async () => {
    let calls = 0
    const a = await app(dep(Pod.eager(counter, { isolation: 'host' })), () => { calls++; return standIn })
    expect(await a.call('r', 'c').inc!(null)).toEqual({ ok: true, value: 'host' })
    expect(await a.call('r', 'h').inc!(null)).toEqual({ ok: true, value: 'host' })
    expect(calls).toBe(0)
  })
  test('given no isolate, then a sandbox pod fails invalid-input', async () => {
    const a = await app(dep(Pod.lazy(counter, { isolation: 'sandbox' })))
    expect(await a.call('r', 'c').inc!(null)).toEqual({ ok: false, fail: { type: 'invalid-input', reason: 'no host for isolation sandbox' } })
  })
  test('given a stand-in with another coord, then invalid-input', async () => {
    const a = await app(dep(Pod.lazy(counter, { isolation: 'sandbox' })), () => other)
    expect(await a.call('r', 'c').inc!(null)).toEqual({ ok: false, fail: { type: 'invalid-input', reason: 'isolate gave acme/other for acme/counter' } })
  })
  test('given isolate throws, then threw', async () => {
    const a = await app(dep(Pod.lazy(counter, { isolation: 'sandbox' })), () => { throw new Error('no frame') })
    expect(await a.call('r', 'c').inc!(null)).toMatchObject({ ok: false, fail: { type: 'threw' } })
  })
  test('given apply switches c from host to isolated-sandbox, then the old build closes changed and the next call goes through isolate', async () => {
    let calls = 0
    const a = await app(dep(Pod.lazy(counter)), () => { calls++; return standIn })
    const events: unknown[] = []
    a.listen(e => events.push(e))
    expect(await a.call('r', 'c').inc!(null)).toEqual({ ok: true, value: 'host' })
    expect(await a.apply(dep(Pod.lazy(counter, { isolation: 'isolated-sandbox' })))).toEqual({ ok: true, value: undefined })
    expect(events).toContainEqual({ type: 'closed', pod: 'c', reason: 'changed' })
    expect(await a.call('r', 'c').inc!(null)).toEqual({ ok: true, value: 'stand-in' })
    expect(calls).toBe(1)
  })
  test('given a built stand-in, then its close listener runs on app.close()', async () => {
    closedStandIn = 0
    const a = await app(dep(Pod.eager(counter, { isolation: 'sandbox' })), () => standIn)
    await a.close()
    expect(closedStandIn).toBe(1)
  })
})
