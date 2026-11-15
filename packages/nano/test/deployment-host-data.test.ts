/**
 * AppDeployment's host-owned `providers` and `views` (plan Task 1, specs: 2026-11-14-pods-runtimes-application-design.md
 * "Data"). nano shape-checks them and otherwise ignores them, written first.
 */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import {
  Pod, assemble, createRegistry, defineSchema, iface, implementation, op, provide, provider, success, type AppDeployment,
} from '../src/index.ts'

const Num = defineSchema('Num', Type.Integer())
const Nothing = defineSchema('Nothing', Type.Null())
const Counter = iface('acme.Counter', { inc: op.action('inc', Nothing, Num) })
const counter = implementation('acme/counter', { provides: [Counter], make: () => {
  let n = 0
  return [provide(Counter, { inc: async () => success(++n) })]
} })

const registry = () => { const r = createRegistry(); r.add(provider('acme', [counter])); return r }
const d: AppDeployment = { pods: { c: Pod.lazy(counter) }, runtimes: { r: { pods: ['c'], subscriptions: [] } } }

describe('an AppDeployment carries host-owned providers and views', () => {
  test('given providers and views, when assembled, then it succeeds and builds the same runtimes as without them', () => {
    const plain = assemble(d, registry())
    const hosted = assemble({ ...d, providers: { acme: './acme.js' }, views: { c: 'acme-counter' } }, registry())
    expect(hosted.ok).toBe(true)
    expect(hosted.ok && plain.ok && JSON.stringify(hosted.value)).toBe(plain.ok && JSON.stringify(plain.value))
  })

  test('given a non-string provider URL or view, when assembled, then it is invalid-input naming the key', () => {
    const bad = assemble({ ...d, views: { c: 3 } }, registry())
    expect(bad).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(!bad.ok && bad.fail.reason).toContain('views')
    expect(assemble({ ...d, providers: { acme: 3 } }, registry())).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })

  test('given a views key that is not an id, when assembled, then it is invalid-input', () => {
    expect(assemble({ ...d, views: { '': 'x' } }, registry())).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
})
