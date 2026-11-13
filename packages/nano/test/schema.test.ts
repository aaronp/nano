import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { canonicalSchema, defineSchema, hashOf } from '../src/schema.ts'

describe('defineSchema', () => {
  test('equal schemas hash equal, whatever their key order', () => {
    const a = defineSchema('a', Type.Object({ x: Type.String(), y: Type.Number() }))
    const b = defineSchema('b', Type.Object({ y: Type.Number(), x: Type.String() }))
    expect(a.hash).toBe(b.hash)
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('a description, title or example does not change the hash', () => {
    const plain = defineSchema('p', Type.Object({ x: Type.String() }))
    const noted = defineSchema('n', Type.Object({ x: Type.String({ description: 'd', title: 't', examples: ['e'] }) }, { description: 'o' }))
    expect(noted.hash).toBe(plain.hash)
  })

  test('a property named description does change the hash', () => {
    const a = defineSchema('a', Type.Object({ x: Type.String() }))
    const b = defineSchema('b', Type.Object({ x: Type.String(), description: Type.String() }))
    expect(b.hash).not.toBe(a.hash)
    expect(canonicalSchema(b.schema)).toContain('"description":{')
  })

  test('different constraints hash differently', () => {
    expect(defineSchema('a', Type.String()).hash).not.toBe(defineSchema('b', Type.String({ minLength: 1 })).hash)
  })

  test('check narrows to the schema', () => {
    const d = defineSchema('n', Type.Number())
    expect(d.check(1)).toBe(true)
    expect(d.check('1')).toBe(false)
  })

  test('decode returns the value when it fits, undefined when it does not or is not JSON', () => {
    const d = defineSchema('o', Type.Object({ x: Type.Number() }))
    expect(d.decode(d.encode({ x: 1 }))).toEqual({ x: 1 })
    expect(d.decode('{"x":"no"}')).toBeUndefined()
    expect(d.decode('{nope')).toBeUndefined()
  })

  test('a Refine in the schema throws schema is not JSON', () => {
    const bytes = Type.Refine(Type.Unsafe<Uint8Array>({}), v => v instanceof Uint8Array)
    expect(() => defineSchema('bin', bytes)).toThrow('bin: schema is not JSON')
    expect(() => defineSchema('nested', Type.Object({ b: bytes }))).toThrow('nested: schema is not JSON')
  })

  test('a function inside the schema throws schema is not JSON', () => {
    expect(() => defineSchema('fn', Type.Unsafe({ f: () => 1 }))).toThrow('fn: schema is not JSON')
  })
})

test('hashOf is blake3 hex of the text', () => {
  expect(hashOf('')).toBe('af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262')
})
