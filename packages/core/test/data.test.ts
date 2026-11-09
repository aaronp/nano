import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { err, isOk, ok, Ops } from '../src'

test('an op is named by its namespace and name', () => {
  expect(Ops.key(Ops.action('com.acme', 'inc', Type.Null(), Type.Number()))).toBe('com.acme/inc')
})

test('a Result is a value or an error', () => {
  expect(isOk(ok(1))).toBe(true)
  expect(isOk(err('x'))).toBe(false)
  expect(ok(1)).toEqual({ value: 1 })
  expect('detail' in ok(1)).toBe(false)
  expect(err('x', 2)).toEqual({ error: 'x', detail: 2 })
})
