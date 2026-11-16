import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { canonicalSchema, Schema, hashOf } from '../src/schema.ts'

describe('Schema.define', () => {
  test('equal schemas hash equal, whatever their key order', () => {
    const a = Schema.define('a', Type.Object({ x: Type.String(), y: Type.Number() }))
    const b = Schema.define('b', Type.Object({ y: Type.Number(), x: Type.String() }))
    expect(a.hash).toBe(b.hash)
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('a description, title or example does not change the hash', () => {
    const plain = Schema.define('p', Type.Object({ x: Type.String() }))
    const noted = Schema.define('n', Type.Object({ x: Type.String({ description: 'd', title: 't', examples: ['e'] }) }, { description: 'o' }))
    expect(noted.hash).toBe(plain.hash)
  })

  test('a property named description does change the hash', () => {
    const a = Schema.define('a', Type.Object({ x: Type.String() }))
    const b = Schema.define('b', Type.Object({ x: Type.String(), description: Type.String() }))
    expect(b.hash).not.toBe(a.hash)
    expect(canonicalSchema(b.schema)).toContain('"description":{')
  })

  test('different constraints hash differently', () => {
    expect(Schema.define('a', Type.String()).hash).not.toBe(Schema.define('b', Type.String({ minLength: 1 })).hash)
  })

  test('check narrows to the schema', () => {
    const d = Schema.define('n', Type.Number())
    expect(d.check(1)).toBe(true)
    expect(d.check('1')).toBe(false)
  })

  test('decode returns the value when it fits, undefined when it does not or is not JSON', () => {
    const d = Schema.define('o', Type.Object({ x: Type.Number() }))
    expect(d.decode(d.encode({ x: 1 }))).toEqual({ x: 1 })
    expect(d.decode('{"x":"no"}')).toBeUndefined()
    expect(d.decode('{nope')).toBeUndefined()
  })

  test('a Refine in the schema throws schema is not JSON', () => {
    const bytes = Type.Refine(Type.Unsafe<Uint8Array>({}), v => v instanceof Uint8Array)
    expect(() => Schema.define('bin', bytes)).toThrow('bin: schema is not JSON')
    expect(() => Schema.define('nested', Type.Object({ b: bytes }))).toThrow('nested: schema is not JSON')
  })

  test('a function inside the schema throws schema is not JSON', () => {
    expect(() => Schema.define('fn', Type.Unsafe({ f: () => 1 }))).toThrow('fn: schema is not JSON')
  })
})

test('hashOf is blake3 hex of the text', () => {
  expect(hashOf('')).toBe('af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262')
})

describe('canonicalSchema details', () => {
  const h = (s: any) => Schema.define('x', s).hash
  test('const values are kept verbatim, so constants differing only in a title hash differently', () => {
    expect(h(Type.Unsafe({ const: { a: 1, title: 'x' } }))).not.toBe(h(Type.Unsafe({ const: { a: 1, title: 'y' } })))
  })
  test('enum and default values are kept verbatim', () => {
    expect(h(Type.Unsafe({ enum: [{ description: 'a' }] }))).not.toBe(h(Type.Unsafe({ enum: [{ description: 'b' }] })))
    expect(h(Type.Unsafe({ default: { title: 'a' } }))).not.toBe(h(Type.Unsafe({ default: { title: 'b' } })))
  })
  test('$comment is stripped', () => {
    expect(h(Type.Unsafe({ type: 'string', $comment: 'hi' }))).toBe(h(Type.Unsafe({ type: 'string' })))
  })
  test('annotations inside $defs and patternProperties are stripped, but names are kept', () => {
    const a = Type.Unsafe({ $defs: { description: { type: 'string', description: 'p' } }, patternProperties: { '^x': { type: 'string', title: 't' } } })
    const b = Type.Unsafe({ $defs: { description: { type: 'string' } }, patternProperties: { '^x': { type: 'string' } } })
    expect(h(a)).toBe(h(b))
    expect(canonicalSchema(a)).toContain('"description":{')
  })
  test('required in a different order hashes the same, and a property named required is kept', () => {
    expect(h(Type.Unsafe({ required: ['a', 'b'] }))).toBe(h(Type.Unsafe({ required: ['b', 'a'] })))
    expect(canonicalSchema(Type.Object({ required: Type.String() }))).toContain('"properties":{"required":{')
  })
})
