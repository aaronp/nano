/** `calls` on `Implementation.define`: declared op-to-dependency-op calls, as op constants, checked at define time. */
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Coord, Implementation, Op } from '../src/index.ts'

const ns = Coord.namespace('acme')
const Store = ns.interface('Store', { save: Op.action(Type.String(), Type.Null()) })
const Mail = ns.interface('Mail', { send: Op.action(Type.Null(), Type.Null()) })
const def = (calls?: any, dependencies: any = { store: Store }) =>
  Implementation.define(ns.implementationId('m'), { provides: [Mail], dependencies, calls, make: () => [] as never })

test('calls is kept as role.op names, {} when none', () => {
  expect(def({ send: { store: [Store.ops.save] } }).calls).toEqual({ send: ['store.save'] })
  expect(def().calls).toEqual({})
})
test('checks op, role and dependency op', () => {
  expect(() => def({ nope: { store: [Store.ops.save] } })).toThrow(/nope is not an op this implementation provides/)
  expect(() => def({ send: { db: [Store.ops.save] } })).toThrow(/db is not a dependency/)
  expect(() => def({ send: { store: [Mail.ops.send] } })).toThrow(/acme\.Store has no op send/)
})
test('a role without an interface is not checkable', () => {
  expect(def({ send: { x: [Mail.ops.send] } }, { x: { interface: 'acme/Other' } }).calls).toEqual({ send: ['x.send'] })
})
test('calls is type-checked: op name, role, and the role\'s ops', () => {
  const typed = (calls: Parameters<typeof Implementation.define<[typeof Mail], { store: typeof Store }>>[1]['calls']) => calls
  typed({ send: { store: [Store.ops.save] } })
  // @ts-expect-error not an op of Mail
  typed({ nope: { store: [Store.ops.save] } })
  // @ts-expect-error not a role
  typed({ send: { db: [Store.ops.save] } })
  // @ts-expect-error an op of another interface
  typed({ send: { store: [Mail.ops.send] } })
})
