/** `AppDeployment.edit` pipes and unpipes (a pipe appended to or removed from a runtime's subscriptions), and the exported `lookup`. */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { AppDeployment, Implementation, Interface, Op, Pod, Provider, Registry, Schema, lookup, provide, success } from '../src/index.ts'

const Nothing = Schema.define(Type.Null(), 'Nothing')
const Num = Schema.define(Type.Integer(), 'Num')
const Counter = Interface.define('acme.Counter', { inc: Op.action(Nothing, Num) })
const Log = Interface.define('acme.Log', { record: Op.action(Num, Nothing) })
const counter = Implementation.define('acme/counter', { provides: [Counter], make: () => [provide(Counter, { inc: async () => success(1) })] })
const log = Implementation.define('acme/log', { provides: [Log], make: () => [provide(Log, { record: async () => success(null) })] })
const registry = Registry.create()
registry.add(Provider.define('acme', [counter, log]))

const base = (): AppDeployment => ({
  pods: { c: Pod.lazy(counter), c2: Pod.lazy(counter), l: Pod.lazy(log), r: Pod.lazy(log) },
  runtimes: { main: { pods: ['c', 'c2', 'l'], subscriptions: [] }, other: { pods: ['r'], subscriptions: [] } },
})
const p = { from: 'c', source: 'acme.Counter/inc', to: 'l', target: 'acme.Log/record' }
const q = { ...p, from: 'c2' }
const failType = (f: () => void) => { try { f() } catch (e) { return (e as { fail: { type: string } }).fail.type } }

describe('AppDeployment.edit pipes', () => {
  test('pipe adds a pipe in the runtime', () => {
    const e = AppDeployment.edit(base(), registry)
    e.pipe('main', p)
    const d = e.deployment()
    expect(d.runtimes.main!.subscriptions.at(-1)).toEqual({ kind: 'pipe', ...p })
    expect(AppDeployment.assemble(d, registry).ok).toBe(true)
  })
  test('pipe refuses a pod not placed there', () => {
    const e = AppDeployment.edit(base(), registry)
    expect(failType(() => e.pipe('other', p))).toBe('not-found')
    expect(failType(() => e.pipe('nowhere', p))).toBe('not-found')
  })
  test('pipe refuses a duplicate', () => {
    const e = AppDeployment.edit(base(), registry)
    e.pipe('main', p)
    expect(failType(() => e.pipe('main', p))).toBe('invalid-input')
  })
  test('unpipe removes only the matching pipe', () => {
    const e = AppDeployment.edit(base(), registry)
    e.pipe('main', p); e.pipe('main', q)
    e.unpipe('main', p)
    expect(e.deployment().runtimes.main!.subscriptions).toEqual([{ kind: 'pipe', ...q }])
  })
  test('unpipe of a missing pipe', () => {
    const e = AppDeployment.edit(base(), registry)
    expect(failType(() => e.unpipe('main', p))).toBe('not-found')
  })
  test('lookup is exported', () => {
    const d = base()
    expect(lookup(d).placedIn.get('r')).toEqual(['other'])
    expect(lookup(d)).toBe(lookup(d))
  })
})
