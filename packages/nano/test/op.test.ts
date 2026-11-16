import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { canonicalSchema, Schema } from '../src/schema.ts'
import { Op, fits } from '../src/op.ts'
import { Interface, port, type Client } from '../src/iface.ts'
import { success } from '../src/result.ts'

const Str = Schema.define('Str', Type.String())
const Num = Schema.define('Num', Type.Number())
const Any = Schema.define('Any', Type.Unknown())
const Nothing = Schema.define('Nothing', Type.Null())

describe('op coordinates', () => {
  test('two ops with the same name and schemas have the same coord', () => {
    expect(Op.action('get', Str, Num).coord).toBe(Op.action('get', Str, Num).coord)
  })
  test('same name, different output: different coord', () => {
    expect(Op.action('get', Str, Num).coord).not.toBe(Op.action('get', Str, Str).coord)
  })
  test('the description does not count', () => {
    expect(Op.action('get', Str, Num, { description: 'x' }).coord).toBe(Op.action('get', Str, Num).coord)
  })
  test('an event has its data as its output and no input', () => {
    const e = Op.event('tick', Num)
    expect([e.kind, e.input, e.output]).toEqual(['event', undefined, Num])
    expect(e.coord).not.toBe(Op.event('tick', Str).coord)
  })
})

describe('fits', () => {
  test("an event fits an action taking its data", () => expect(fits(Op.event('t', Num), Op.action('r', Num, Nothing))).toBe(true))
  test('different types do not', () => expect(fits(Op.event('t', Num), Op.action('r', Str, Nothing))).toBe(false))
  test('a target that takes anything accepts any event', () => {
    expect(fits(Op.event('t', Num), Op.action('r', Any, Nothing))).toBe(true)
  })
  test('Unknown and Any both canonicalise to {}', () => {
    expect(canonicalSchema(Type.Unknown())).toBe('{}')
    expect(canonicalSchema(Type.Any())).toBe('{}')
  })
})

describe('Interface.define', () => {
  const get = Op.action('get', Str, Num)
  test('indexes its ops by coord', () => {
    const i = Interface.define('acme/db', { get })
    expect(i.byCoord.get(get.coord)).toBe(get)
  })
  test('a bad coordinate throws', () => {
    expect(() => Interface.define('db', { get })).toThrow('bad interface coordinate db')
  })
  test('dotted and slashed coordinates are accepted', () => {
    expect(Interface.define('com.example.DB', { get }).coord).toBe('com.example.DB')
  })
  test('a key that differs from the op name throws', () => {
    expect(() => Interface.define('acme/db', { put: get })).toThrow('acme/db: op put is named get')
  })
  test('a port is the interface coord and the op name', () => {
    const Log = Interface.define('acme.Log', { record: Op.action('record', Num, Nothing) })
    expect(port(Log, Log.ops.record)).toBe('acme.Log/record')
  })
  test('Client types an action as a promise of a result', () => {
    const i = Interface.define('acme/db', { get })
    const c: Client<typeof i> = { get: async (s: string) => success(s.length) }
    expect(Object.keys(c)).toEqual(['get'])
  })
  test('Client has no key for an event', () => {
    const i = Interface.define('acme/db', { get, tick: Op.event('tick', Num) })
    const c: Client<typeof i> = { get: async (s: string) => success(s.length) }
    // @ts-expect-error events are not callable
    void c.tick
    expect(Object.keys(c)).toEqual(['get'])
  })
})
