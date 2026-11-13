import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op, fits } from '../src/op.ts'
import { iface, type Client } from '../src/iface.ts'
import { success, type NanoResult } from '../src/result.ts'

const Str = defineSchema('Str', Type.String())
const Num = defineSchema('Num', Type.Number())
const Any = defineSchema('Any', Type.Unknown())

describe('op coordinates', () => {
  test('two ops with the same name and schemas have the same coord', () => {
    expect(op.action('get', Str, Num).coord).toBe(op.action('get', Str, Num).coord)
  })
  test('same name, different output: different coord', () => {
    expect(op.action('get', Str, Num).coord).not.toBe(op.action('get', Str, Str).coord)
  })
  test('the description does not count', () => {
    expect(op.action('get', Str, Num, { description: 'x' }).coord).toBe(op.action('get', Str, Num).coord)
  })
  test('sources and sinks have one side only', () => {
    const s = op.source('tick', Num), k = op.sink('log', Str)
    expect([s.kind, s.input, k.kind, k.output]).toEqual(['source', undefined, 'sink', undefined])
    expect(s.coord).not.toBe(op.source('tick', Str).coord)
  })
})

describe('fits', () => {
  test('equal types fit', () => expect(fits(op.source('a', Num), op.sink('b', Num))).toBe(true))
  test('different types do not', () => expect(fits(op.source('a', Num), op.sink('b', Str))).toBe(false))
  test('a target that takes anything accepts any source', () => {
    expect(fits(op.source('a', Num), op.sink('b', Any))).toBe(true)
  })
  test('Unknown and Any both canonicalise to {}', async () => {
    const { canonicalSchema } = await import('../src/schema.ts')
    expect(canonicalSchema(Type.Unknown())).toBe('{}')
    expect(canonicalSchema(Type.Any())).toBe('{}')
  })
  test('a source with no output fits nothing', () => expect(fits(op.sink('a', Num), op.sink('b', Num))).toBe(false))
})

describe('iface', () => {
  const get = op.action('get', Str, Num)
  test('indexes its ops by coord', () => {
    const i = iface('acme/db', { get })
    expect(i.byCoord.get(get.coord)).toBe(get)
  })
  test('a bad coordinate throws', () => {
    expect(() => iface('db', { get })).toThrow('bad interface coordinate db')
    expect(iface('com.example.DB', { get }).coord).toBe('com.example.DB')
  })
  test('a key that differs from the op name throws', () => {
    expect(() => iface('acme/db', { put: get })).toThrow('acme/db: op put is named get')
  })
  test('Client types an action as a promise of a result', () => {
    const i = iface('acme/db', { get, log: op.sink('log', Str) })
    const c: Client<typeof i> = {
      get: async (s: string) => success(s.length),
      log: async (_s: string): Promise<NanoResult<void>> => success(undefined),
    }
    expect(Object.keys(c)).toEqual(['get', 'log'])
  })
})
