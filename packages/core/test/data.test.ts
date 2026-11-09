import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { canonical, err, isOk, ok, Ops } from '../src'

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

test('fits: an output fits an input of the same type (name included), or one that takes anything', () => {
  const num = Ops.source('a', 'n', Type.Number({ title: 'number' }))
  expect(Ops.fits(num, Ops.sink('b', 'take', Type.Number({ title: 'number' })))).toBe(true)
  expect(Ops.fits(num, Ops.sink('b', 'take', Type.Number({ title: 'Meters' })))).toBe(false)   // a brand is not its base
  expect(Ops.fits(num, Ops.sink('b', 'any', Type.Unknown()))).toBe(true)
  expect(Ops.fits(num, Ops.sink('b', 'str', Type.String()))).toBe(false)
  expect(Ops.fits(Ops.sink('b', 'take', Type.Number()), num)).toBe(false)   // a sink has no output; a source no input
  expect(canonical({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}')
})
