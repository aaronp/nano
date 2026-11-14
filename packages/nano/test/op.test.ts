import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { canonicalSchema, defineSchema } from '../src/schema.ts'
import { op, fits } from '../src/op.ts'
import { iface, port, type Client } from '../src/iface.ts'
import { success } from '../src/result.ts'

const Str = defineSchema('Str', Type.String())
const Num = defineSchema('Num', Type.Number())
const Any = defineSchema('Any', Type.Unknown())
const Nothing = defineSchema('Nothing', Type.Null())

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
  test('an event has its data as its output and no input', () => {
    const e = op.event('tick', Num)
    expect([e.kind, e.input, e.output]).toEqual(['event', undefined, Num])
    expect(e.coord).not.toBe(op.event('tick', Str).coord)
  })
})

describe('fits', () => {
  test("an event fits an action taking its data", () => expect(fits(op.event('t', Num), op.action('r', Num, Nothing))).toBe(true))
  test('different types do not', () => expect(fits(op.event('t', Num), op.action('r', Str, Nothing))).toBe(false))
  test('a target that takes anything accepts any event', () => {
    expect(fits(op.event('t', Num), op.action('r', Any, Nothing))).toBe(true)
  })
  test('Unknown and Any both canonicalise to {}', () => {
    expect(canonicalSchema(Type.Unknown())).toBe('{}')
    expect(canonicalSchema(Type.Any())).toBe('{}')
  })
})

describe('iface', () => {
  const get = op.action('get', Str, Num)
  test('indexes its ops by coord', () => {
    const i = iface('acme/db', { get })
    expect(i.byCoord.get(get.coord)).toBe(get)
  })
  test('a bad coordinate throws', () => {
    expect(() => iface('db', { get })).toThrow('bad interface coordinate db')
  })
  test('dotted and slashed coordinates are accepted', () => {
    expect(iface('com.example.DB', { get }).coord).toBe('com.example.DB')
  })
  test('a key that differs from the op name throws', () => {
    expect(() => iface('acme/db', { put: get })).toThrow('acme/db: op put is named get')
  })
  test('a port is the interface coord and the op name', () => {
    const Log = iface('acme.Log', { record: op.action('record', Num, Nothing) })
    expect(port(Log, Log.ops.record)).toBe('acme.Log/record')
  })
  test('Client types an action as a promise of a result', () => {
    const i = iface('acme/db', { get })
    const c: Client<typeof i> = { get: async (s: string) => success(s.length) }
    expect(Object.keys(c)).toEqual(['get'])
  })
  test('Client has no key for an event', () => {
    const i = iface('acme/db', { get, tick: op.event('tick', Num) })
    const c: Client<typeof i> = { get: async (s: string) => success(s.length) }
    // @ts-expect-error events are not callable
    void c.tick
    expect(Object.keys(c)).toEqual(['get'])
  })
})
