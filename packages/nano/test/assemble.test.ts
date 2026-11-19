// Validation per level (spec: 2026-11-14-pods-runtimes-application-design.md, "Validation, per level"); fixtures in fixtures/acme-assemble.ts.
import { describe, expect, test } from 'bun:test'
import { Pod } from '../src/pod.ts'
import { Runtime } from '../src/runtime.ts'
import { AppDeployment } from '../src/deployment.ts'
import { counter, kv, registry, ok, fails, pods, runtime } from './fixtures/acme-assemble.ts'

describe('assemble', () => {
  test('a valid app deployment is its runtimes', () => {
    const d = { pods: { c: Pod.lazy(counter), k: Pod.lazy(kv), x: Pod.lazy(kv) },
      runtimes: { a: { pods: ['c', 'k'], subscriptions: [{ kind: 'call', from: 'c', to: 'k' }] }, b: { pods: ['k'], subscriptions: [] } }, tags: { k: ['primary'] } }
    const rs = ok(AppDeployment.assemble(d, registry))
    expect(Object.keys(rs)).toEqual(['a', 'b'])
    expect<unknown>([rs.a!.id, rs.a!.pods.names(), rs.a!.deployment(), rs.b!.pods.names()]).toEqual(['a', ['c', 'k'], d.runtimes.a, ['k']])
  })
  test('something that is not an app deployment is invalid-input', () => {
    for (const d of [null, 3, {}, { pods: {}, runtimes: [] }, { pods: {}, runtimes: {}, x: 1 }])
      expect(AppDeployment.assemble(d, registry)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
  test('the first failure of a level is the result', () => {
    fails(AppDeployment.assemble({ pods: { x: { implementation: 'acme/nope', eager: false } }, runtimes: {} }, registry), 'not-found', 'acme/nope')
    fails(AppDeployment.assemble({ pods: {}, runtimes: { r: { pods: ['ghost'], subscriptions: [] } } }, registry), 'invalid-input', 'ghost')
  })
  test("a runtime's shape and placement are reported in Runtime.create's words, not select's", () => {
    fails(AppDeployment.assemble({ pods: {}, runtimes: { r: { pods: 'x', subscriptions: [] } } }, registry), 'invalid-input', 'runtime r /pods')
    fails(AppDeployment.assemble({ pods: { c: Pod.lazy(counter) }, runtimes: { r: { pods: ['c', 'c'], subscriptions: [] } } }, registry), 'invalid-input', 'c is placed twice')
  })
  test('more than 50 runtimes', () => {
    const runtimes = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`r${i}`, { pods: [], subscriptions: [] }]))
    fails(AppDeployment.assemble({ pods: {}, runtimes }, registry), 'invalid-input', '/runtimes')
  })
  test('runtime ids follow the id rule', () => {
    for (const bad of ['', 'a/b', 'x'.repeat(65)])
      fails(AppDeployment.assemble({ pods: {}, runtimes: { [bad]: { pods: [], subscriptions: [] } } }, registry), 'invalid-input', '/runtimes')
  })
})

test('a pod name has no dots, so a rule never reads it as an interface or port coordinate', () => {
  const r = AppDeployment.assemble({ pods: { 'acme.Db': { implementation: 'acme/mem', eager: false } }, runtimes: { r: { pods: ['acme.Db'], subscriptions: [] } } }, registry)
  expect(r).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
})
