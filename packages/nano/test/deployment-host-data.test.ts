/**
 * AppDeployment's host-owned `modules` and `views` (plan Task 1, specs: 2026-11-14-pods-runtimes-application-design.md
 * "Data"). nano shape-checks them and otherwise ignores them, written first.
 */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import {
  Pod,
  AppDeployment,
  Registry,
  Schema,
  Interface,
  Implementation,
  Op,
  provide,
  Provider,
  success,
} from '../src/index.ts'

const Num = Schema.define(Type.Integer(), 'Num')
const Nothing = Schema.define(Type.Null(), 'Nothing')
const Counter = Interface.define('acme.Counter', { inc: Op.action(Nothing, Num) })
const counter = Implementation.define('acme/counter', { provides: [Counter], make: () => {
  let n = 0
  return [provide(Counter, { inc: async () => success(++n) })]
} })

const registry = () => { const r = Registry.create(); r.add(Provider.define('acme', [counter])); return r }
const d: AppDeployment = { pods: { c: Pod.lazy(counter) }, runtimes: { r: { pods: ['c'], subscriptions: [] } } }

describe('an AppDeployment carries host-owned modules and views', () => {
  test('given modules and views, when assembled, then it succeeds and builds the same runtimes as without them', () => {
    const plain = AppDeployment.assemble(d, registry())
    const hosted = AppDeployment.assemble({ ...d, modules: { acme: './acme.js' }, views: { c: 'acme-counter' } }, registry())
    expect(hosted.ok).toBe(true)
    expect(hosted.ok && plain.ok && JSON.stringify(hosted.value)).toBe(plain.ok && JSON.stringify(plain.value))
  })

  test('given a non-string provider URL or view, when assembled, then it is invalid-input naming the key', () => {
    const bad = AppDeployment.assemble({ ...d, views: { c: 3 } }, registry())
    expect(bad).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(!bad.ok && bad.fail.reason).toContain('views')
    expect(AppDeployment.assemble({ ...d, modules: { acme: 3 } }, registry())).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })

  test('given a views key that is not an id, when assembled, then it is invalid-input', () => {
    expect(AppDeployment.assemble({ ...d, views: { '': 'x' } }, registry())).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
})
