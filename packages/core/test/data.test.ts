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

test('fits ignores description, examples and $comment, at any depth', () => {
  const from = Ops.source('t', 'a', Type.Array(Type.Number({ description: 'd', examples: [1], $comment: 'c' }), { description: 'list' }))
  expect(Ops.fits(from, Ops.action('t', 'b', Type.Array(Type.Number()), Type.Void()))).toBe(true)
})

test('a title still separates types after annotations go', () => {
  const from = Ops.source('t', 'a', Type.Object({}, { title: 'A', description: 'x' }))
  expect(Ops.fits(from, Ops.action('t', 'b', Type.Object({}, { title: 'B' }), Type.Void()))).toBe(false)
  expect(Ops.fits(from, Ops.action('t', 'b', Type.Object({}, { title: 'A' }), Type.Void()))).toBe(true)
})

test('a described Unknown takes anything', () => {
  expect(Ops.fits(Ops.source('t', 'a', Type.Number()), Ops.action('t', 'b', Type.Unknown({ description: 'x', examples: [1] }), Type.Void()))).toBe(true)
})

test('ops carry a description when given', () => {
  expect(Ops.source('t', 'x', Type.Number(), { description: 'd' }).description).toBe('d')
  expect(Ops.action('t', 'x', Type.Number(), Type.Void(), { description: 'a' }).description).toBe('a')
  expect(Ops.sink('t', 'x', Type.Number(), { description: 's' }).description).toBe('s')
  expect('description' in Ops.source('t', 'x', Type.Number())).toBe(false)
})

test('a property named like an annotation is still a property', () => {
  const from = Ops.source('t', 'a', Type.Object({ description: Type.String(), examples: Type.String() }))
  expect(Ops.fits(from, Ops.sink('t', 'b', Type.Object({ description: Type.Number(), examples: Type.String() })))).toBe(false)
  expect(Ops.fits(from, Ops.sink('t', 'b', Type.Object({ description: Type.String({ description: 'd' }), examples: Type.String() })))).toBe(true)
})
