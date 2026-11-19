// Validation per level (spec: 2026-11-14-pods-runtimes-application-design.md, "Validation, per level"); fixtures in fixtures/acme-assemble.ts.
import { describe, expect, test } from 'bun:test'
import { success } from '../src/result.ts'
import { Pod } from '../src/pod.ts'
import { Pods } from '../src/pods.ts'
import { Runtime } from '../src/runtime.ts'
import { counter, kv, sender, ticker, log, sized, ok, fails, pods, runtime, pipe, ev } from './fixtures/acme-assemble.ts'

describe('Pods.create', () => {
  test("a pod named 'host' is invalid-input", () => {
    expect(pods({ host: Pod.lazy(sized, { config: 3 }) })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
  test('a valid pod deployment is itself, in order, and nothing it hands out changes it', () => {
    const d = { t: Pod.eager(ticker), z: Pod.lazy(sized, { config: 3 }) }
    const p = ok(pods(d))
    expect([p.names(), p.deployment(), p.get('z')]).toEqual([['t', 'z'], d, d.z])
    d.z.config = 4
    p.deployment().t!.eager = false
    p.get('t')!.eager = false
    expect(p.deployment()).toEqual({ t: Pod.eager(ticker), z: Pod.lazy(sized, { config: 3 }) })
    expect(p.get('constructor')).toBeUndefined()
  })
  test('something that is not a pod deployment is invalid-input', () => {
    for (const d of [null, 3, [], { a: 1 }, { a: { implementation: 'acme/kv' } }]) expect(pods(d)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
  test('an unknown implementation is not-found', () => {
    fails(pods({ x: { implementation: 'acme/nope', eager: false } }), 'not-found', 'acme/nope')
  })
  test('a config that does not fit the implementation', () => {
    fails(pods({ z: Pod.lazy(sized, { config: 'big' }) }), 'invalid-input', 'z')
  })
  test('more than 5000 pods', () => {
    fails(pods(Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`p${i}`, Pod.lazy(counter)]))), 'invalid-input', 'more than 5000')
  })
  test('pod names follow the id rule', () => {
    for (const bad of ['', 'a/b', 'x'.repeat(65)]) fails(pods({ [bad]: Pod.lazy(counter) }), 'invalid-input', 'the id rule')
  })
  test('select scopes the lookup; a duplicate name is invalid-input, an unknown one not-found', () => {
    const p = ok(pods({ a: Pod.lazy(counter), b: Pod.lazy(kv) }))
    expect(ok(p.select(['b'])).deployment()).toEqual({ b: Pod.lazy(kv) })
    fails(p.select(['a', 'a']), 'invalid-input', 'a')
    fails(p.select(['zz']), 'not-found', 'zz')
    expect(p.select('a' as never)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
})

describe('Runtime.create', () => {
  test('a valid runtime deployment is itself, with its scope', () => {
    const d = { t: Pod.eager(ticker), l: Pod.lazy(log), s: Pod.lazy(sender), k: Pod.lazy(kv) }
    const subs = [ev('acme.Ticks/tick', 'acme.Log/record'), { kind: 'call', from: 's', to: 'k' }]
    const r = ok(runtime(d, subs))
    expect<unknown>([r.id, r.pods.names(), r.deployment()]).toEqual(['r', ['t', 'l', 's', 'k'], { pods: ['t', 'l', 's', 'k'], subscriptions: subs }])
  })
  test('something that is not a runtime deployment is invalid-input', () => {
    for (const d of [null, 3, {}, { pods: [], subscriptions: [], x: 1 }, { pods: [], subscriptions: [{ kind: 'event', from: 'a', to: 'b' }] }])
      expect(Runtime.create('r', d, ok(pods({})))).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
  test('a pods value not from Pods.create is invalid-input', () => {
    const fake = { names: () => [], get: () => undefined, select: () => success(fake), deployment: () => ({}) }
    expect(Runtime.create('r', { pods: [], subscriptions: [] }, fake)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
  test('a runtime placing a pod outside its scope', () => {
    const p = ok(pods({ a: Pod.lazy(counter), ghost: Pod.lazy(counter) }))
    fails(Runtime.create('r', { pods: ['ghost'], subscriptions: [] }, ok(p.select(['a']))), 'invalid-input', 'ghost')
  })
  test('a pod placed twice in a runtime', () => {
    const p = ok(pods({ a: Pod.lazy(counter) }))
    fails(Runtime.create('r', { pods: ['a', 'a'], subscriptions: [] }, p), 'invalid-input', 'a is placed twice')
  })
  test('a subscription end not placed in its runtime', () => {
    const p = ok(pods({ s: Pod.lazy(sender), k: Pod.lazy(kv) }))
    fails(Runtime.create('r', { pods: ['s'], subscriptions: [{ kind: 'call', from: 's', to: 'k' }] }, p), 'invalid-input', 'k is not placed')
  })
  test('a duplicate subscription in a runtime', () => {
    const s = { kind: 'call', from: 's', to: 'k' }
    fails(runtime({ s: Pod.lazy(sender), k: Pod.lazy(kv) }, [s, { ...s }]), 'invalid-input', 's->k')
  })
  test('a pipe source that is neither an event nor an action of from', () => {
    fails(runtime({ t: Pod.eager(ticker), l: Pod.lazy(log) }, [ev('acme.Log/record', 'acme.Log/record')]), 'invalid-input', 'acme.Log/record')
    fails(runtime({ t: Pod.eager(ticker), l: Pod.lazy(log) }, [ev('acme.Ticks/nope', 'acme.Log/record')]), 'invalid-input', 'acme.Ticks/nope')
  })
  test('a pipe target that is not an action of to', () => {
    fails(runtime({ t: Pod.eager(ticker), l: Pod.lazy(log) }, [ev('acme.Ticks/tick', 'acme.Counter/inc')]), 'invalid-input', 'acme.Counter/inc')
  })
  test('event data that does not fit the target', () => {
    fails(runtime({ t: Pod.eager(ticker), l: Pod.lazy(log) }, [ev('acme.Ticks/said', 'acme.Log/record')]), 'invalid-input', 'acme.Ticks/said')
  })
  test('a pipe from an action result: its output must fit the target input', () => {
    expect(runtime({ c: Pod.lazy(counter), l: Pod.lazy(log) }, [pipe('c', 'acme.Counter/inc', 'l', 'acme.Log/record')]).ok).toBe(true)
    fails(runtime({ k: Pod.lazy(kv), l: Pod.lazy(log) }, [pipe('k', 'acme.KV/put', 'l', 'acme.Log/record')]), 'invalid-input', 'acme.KV/put does not fit')
  })
  test('pipes may form a cycle', () => {
    const loop = [pipe('c', 'acme.Counter/inc', 'l', 'acme.Log/record'), pipe('l', 'acme.Log/record', 'c', 'acme.Counter/inc')]
    expect(runtime({ c: Pod.lazy(counter), l: Pod.lazy(log) }, loop).ok).toBe(true)
  })
  test('a call target not providing a declared dependency', () => {
    fails(runtime({ s: Pod.lazy(sender), c: Pod.lazy(counter) }, [{ kind: 'call', from: 's', to: 'c' }]), 'invalid-input', 'c provides none')
  })
  test('a call from a pod that declares no dependencies may go anywhere', () => {
    expect(runtime({ c: Pod.lazy(counter), k: Pod.lazy(kv) }, [{ kind: 'call', from: 'c', to: 'k' }]).ok).toBe(true)
  })
  test('more than 2000 subscriptions', () => {
    const subs = Array.from({ length: 2001 }, () => ({ kind: 'call', from: 'c', to: 'k' }))
    fails(runtime({ c: Pod.lazy(counter), k: Pod.lazy(kv) }, subs), 'invalid-input', 'runtime r /subscriptions')
  })
})
