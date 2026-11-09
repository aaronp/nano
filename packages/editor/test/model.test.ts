import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { brandOf, builtins, canonical, lookFor, lookOf, hashBytes, sameType, takesAnything, titleOf } from '../src/model'

const num = Type.Number({ title: 'number' })

test('canonical JSON does not depend on key order', () => {
  expect(canonical({ b: 1, a: { d: 2, c: 3 } } as any)).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 } as any))
})

test('a brand is a different type from its base', () => {
  const meters = brandOf(num, 'Meters')
  expect(titleOf(meters)).toBe('Meters')
  expect(sameType(num, Type.Number({ title: 'number' }))).toBe(true)
  expect(sameType(num, meters)).toBe(false)
})

test('Unknown takes anything; a number does not', () => {
  expect(takesAnything(Type.Unknown({ title: 'unknown' }))).toBe(true)
  expect(takesAnything(num)).toBe(false)
})

test('looks come from the type, are stable, and a given look wins', () => {
  const meters = brandOf(num, 'Meters')
  expect(lookFor({ type: num })).toEqual(lookFor({ type: Type.Number({ title: 'number' }) }))
  expect(lookFor({ type: num })).not.toEqual(lookFor({ type: meters }))
  expect(hashBytes(num)).toHaveLength(32)
  const mine = lookOf(hashBytes(meters))
  expect(lookFor({ type: num, look: mine })).toBe(mine)
})

test('the built-ins are string, number, boolean and unknown', () => {
  expect(builtins().map(e => titleOf(e.type))).toEqual(['string', 'number', 'boolean', 'unknown'])
})
