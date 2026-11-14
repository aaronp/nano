import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface } from '../src/iface.ts'
import { success } from '../src/result.ts'
import { implementation, provide } from '../src/implementation.ts'
import { provider } from '../src/provider.ts'
import { createRegistry } from '../src/registry.ts'
import { Pod } from '../src/pod.ts'
import { checkDeployment } from '../src/deployment.ts'

const Str = defineSchema('Str', Type.String())
const Num = defineSchema('Num', Type.Integer())
const Nothing = defineSchema('Nothing', Type.Null())
const Counter = iface('acme.Counter', { inc: op.action('inc', Nothing, Num) })
const KV = iface('acme.KV', { put: op.action('put', Str, Nothing) })
const Ticks = iface('acme.Ticks', { tick: op.event('tick', Num), said: op.event('said', Str) })
const Log = iface('acme.Log', { record: op.action('record', Num, Nothing) })

const counter = implementation('acme/counter', { provides: [Counter], make: () => [provide(Counter, { inc: async () => success(1) })] })
const kv = implementation('acme/kv', { provides: [KV], make: () => [provide(KV, { put: async () => success(null) })] })
const sender = implementation('acme/sender', { provides: [], dependencies: { store: KV }, make: () => [] })
const ticker = implementation('acme/ticker', { provides: [Ticks], make: () => [] })
const log = implementation('acme/log', { provides: [Log], make: () => [provide(Log, { record: async () => success(null) })] })
const sized = implementation('acme/sized', { provides: [], config: Num, make: () => [] })
const registry = createRegistry()
registry.add(provider('acme', [counter, kv, sender, ticker, log, sized]))

type D = { pods: Record<string, unknown>; runtimes: Record<string, { pods: string[]; subscriptions: unknown[] }>; tags?: Record<string, string[]> }
const one = (pods: Record<string, unknown>, subscriptions: unknown[] = []): D => ({ pods, runtimes: { r: { pods: Object.keys(pods), subscriptions } } })
const ev = (source: string, target: string) => ({ kind: 'event', from: 't', source, to: 'l', target })
const fails = (d: unknown, type: string, offender: string) => {
  const r = checkDeployment(d, registry)
  expect(r).toMatchObject({ ok: false, fail: { type } })
  if (!r.ok) expect(r.fail.reason).toContain(offender)
}

describe('checkDeployment', () => {
  test('a valid deployment is itself', () => {
    const d = { ...one({ t: Pod.eager(ticker), l: Pod.lazy(log), s: Pod.lazy(sender), k: Pod.lazy(kv), z: Pod.lazy(sized, { config: 3 }) },
      [ev('acme.Ticks/tick', 'acme.Log/record'), { kind: 'call', from: 's', to: 'k' }]), tags: { k: ['primary'] } }
    expect(checkDeployment(d, registry)).toEqual(success(d) as never)
  })
  test('something that is not a deployment is invalid-input', () => {
    for (const d of [null, 3, {}, { pods: {}, runtimes: [] }]) expect(checkDeployment(d, registry)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
  test('a runtime placing an unknown pod', () => {
    fails({ pods: {}, runtimes: { r: { pods: ['ghost'], subscriptions: [] } } }, 'invalid-input', 'ghost')
  })
  test('a subscription end not placed in its runtime', () => {
    const d = one({ s: Pod.lazy(sender) }, [{ kind: 'call', from: 's', to: 'k' }])
    d.pods.k = Pod.lazy(kv)
    fails(d, 'invalid-input', 'k is not placed')
  })
  test('a duplicate subscription in a runtime', () => {
    const s = { kind: 'call', from: 's', to: 'k' }
    fails(one({ s: Pod.lazy(sender), k: Pod.lazy(kv) }, [s, { ...s }]), 'invalid-input', 's->k')
  })
  test('an event source that is not an event of from', () => {
    fails(one({ t: Pod.eager(ticker), l: Pod.lazy(log) }, [ev('acme.Log/record', 'acme.Log/record')]), 'invalid-input', 'acme.Log/record')
    fails(one({ t: Pod.eager(ticker), l: Pod.lazy(log) }, [ev('acme.Ticks/nope', 'acme.Log/record')]), 'invalid-input', 'acme.Ticks/nope')
  })
  test('an event target that is not an action of to', () => {
    fails(one({ t: Pod.eager(ticker), l: Pod.lazy(log) }, [ev('acme.Ticks/tick', 'acme.Counter/inc')]), 'invalid-input', 'acme.Counter/inc')
  })
  test('event data that does not fit the target', () => {
    fails(one({ t: Pod.eager(ticker), l: Pod.lazy(log) }, [ev('acme.Ticks/said', 'acme.Log/record')]), 'invalid-input', 'acme.Ticks/said')
  })
  test('a call target not providing a declared dependency', () => {
    fails(one({ s: Pod.lazy(sender), c: Pod.lazy(counter) }, [{ kind: 'call', from: 's', to: 'c' }]), 'invalid-input', 'c provides none')
  })
  test('a call from a pod that declares no dependencies may go anywhere', () => {
    expect(checkDeployment(one({ c: Pod.lazy(counter), k: Pod.lazy(kv) }, [{ kind: 'call', from: 'c', to: 'k' }]), registry).ok).toBe(true)
  })
  test('an unknown implementation is not-found', () => {
    fails(one({ x: { implementation: 'acme/nope', eager: false } }), 'not-found', 'acme/nope')
  })
  test('a config that does not fit the implementation', () => {
    fails(one({ z: Pod.lazy(sized, { config: 'big' }) }), 'invalid-input', 'z')
  })
  test('more than 50 runtimes, 5000 pods or 2000 subscriptions in a runtime', () => {
    const runtimes = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`r${i}`, { pods: [], subscriptions: [] }]))
    fails({ pods: {}, runtimes }, 'invalid-input', '/runtimes')
    const pods = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`p${i}`, Pod.lazy(counter)]))
    fails({ pods, runtimes: {} }, 'invalid-input', '/pods')
    const subs = Array.from({ length: 2001 }, () => ({ kind: 'call', from: 'c', to: 'k' }))
    fails(one({ c: Pod.lazy(counter), k: Pod.lazy(kv) }, subs), 'invalid-input', '/runtimes/r/subscriptions')
  })
  test('pod names and runtime ids follow the id rule', () => {
    for (const bad of ['', 'a/b', 'x'.repeat(65)]) {
      fails({ pods: { [bad]: Pod.lazy(counter) }, runtimes: {} }, 'invalid-input', '/pods')
      fails({ pods: {}, runtimes: { [bad]: { pods: [], subscriptions: [] } } }, 'invalid-input', '/runtimes')
    }
  })
})
