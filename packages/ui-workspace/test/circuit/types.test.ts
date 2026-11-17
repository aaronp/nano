import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { padTypeOf } from '../../src/circuit'

test('padTypeOf maps schemas to pad types', () => {
  expect(padTypeOf(Type.String())).toBe('string')
  expect(padTypeOf(Type.Integer())).toBe('number')
  expect(padTypeOf(Type.Number())).toBe('number')
  expect(padTypeOf(Type.Boolean())).toBe('boolean')
  expect(padTypeOf(Type.Object({}))).toBe('object')
  expect(padTypeOf(Type.Array(Type.String()))).toBe('array')
  expect(padTypeOf(Type.Void())).toBe('signal')
  expect(padTypeOf(undefined)).toBe('signal')
  expect(padTypeOf(Type.Union([Type.String(), Type.Number()]))).toBe('any')
  expect(padTypeOf(Type.Unknown())).toBe('any')
})
