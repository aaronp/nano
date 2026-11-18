/** `calls` on `Implementation.define`: declared op-to-dependency-op calls, checked at define time. */
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Coord, Implementation, Interface, Op } from '../src/index.ts'

const ns = Coord.namespace('acme')
const Store = ns.interface('Store', { save: Op.action(Type.Null(), Type.Null()) })
const Mail = ns.interface('Mail', { send: Op.action(Type.Null(), Type.Null()) })
const def = (calls?: Record<string, string[]>, dependencies: any = { store: Store }) =>
  Implementation.define(ns.implementationId('m'), { provides: [Mail], dependencies, calls, make: () => [] as never })

test('calls is kept as given, {} when none', () => {
  expect(def({ send: ['store.save'] }).calls).toEqual({ send: ['store.save'] })
  expect(def().calls).toEqual({})
})
test('checks op, role and dependency op', () => {
  expect(() => def({ nope: ['store.save'] })).toThrow(/nope is not an op this implementation provides/)
  expect(() => def({ send: ['db.save'] })).toThrow(/db is not a dependency/)
  expect(() => def({ send: ['store.nope'] })).toThrow(/Store has no op nope/)
})
test('a role without an interface is not checkable', () => {
  expect(def({ send: ['x.anything'] }, { x: { interface: 'acme/Other' } }).calls).toEqual({ send: ['x.anything'] })
})
