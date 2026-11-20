import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { canonicalSchema, Schema } from '../src/schema.ts'
import { Op, fits } from '../src/op.ts'
import { Interface, port, type Client } from '../src/iface.ts'
import { success } from '../src/result.ts'

const Str = Schema.define(Type.String(), 'Str')
const Num = Schema.define(Type.Number(), 'Num')
const Any = Schema.define(Type.Unknown(), 'Any')
const Nothing = Schema.define(Type.Null(), 'Nothing')

const coordOf = (name: string, o: Parameters<typeof Interface.define>[1][string]) => Interface.define('acme.T', { [name]: o }).ops[name]!.coord

describe('op coordinates', () => {
  test('two ops with the same name and schemas have the same coord', () => {
    expect(coordOf('get', Op.action(Str, Num))).toBe(coordOf('get', Op.action(Str, Num)))
  })
  test('same schemas, different name: different coord', () => {
    expect(coordOf('get', Op.action(Str, Num))).not.toBe(coordOf('put', Op.action(Str, Num)))
  })
  test('same name, different output: different coord', () => {
    expect(coordOf('get', Op.action(Str, Num))).not.toBe(coordOf('get', Op.action(Str, Str)))
  })
  test('the description and the labels do not count', () => {
    expect(coordOf('get', Op.action(Str, Num, { description: 'x' }))).toBe(coordOf('get', Op.action(Str, Num)))
    expect(coordOf('get', Op.action(Type.String(), Num))).toBe(coordOf('get', Op.action(Str, Num)))
  })
  test('an event has its data as its output and no input', () => {
    const e = Op.event(Num)
    expect([e.kind, e.input, e.output]).toEqual(['event', undefined, Num])
    expect(coordOf('tick', e)).not.toBe(coordOf('tick', Op.event(Str)))
  })
})

describe('fits', () => {
  test("an event fits an action taking its data", () => expect(fits(Op.event(Num), Op.action(Num, Nothing))).toBe(true))
  test('different types do not', () => expect(fits(Op.event(Num), Op.action(Str, Nothing))).toBe(false))
  test('a target that takes anything accepts any event', () => {
    expect(fits(Op.event(Num), Op.action(Any, Nothing))).toBe(true)
  })
  test('Unknown and Any both canonicalise to {}', () => {
    expect(canonicalSchema(Type.Unknown())).toBe('{}')
    expect(canonicalSchema(Type.Any())).toBe('{}')
  })
})

describe('Interface.define', () => {
  const get = Op.action(Str, Num)
  test('names each op by its key and indexes it by coord', () => {
    const i = Interface.define('acme.Db', { get })
    expect(i.ops.get.name).toBe('get')
    expect(i.byCoord.get(i.ops.get.coord)).toBe(i.ops.get)
  })
  test('a bad coordinate throws', () => {
    expect(() => Interface.define('db', { get })).toThrow('bad interface coordinate db')
  })
  test('dotted coordinates are accepted; the slash form is not an interface coordinate', () => {
    expect(() => Interface.define('acme/db', { get })).toThrow('bad interface coordinate acme/db')
    expect(Interface.define('com.example.DB', { get }).coord).toBe('com.example.DB')
  })
  test('one signature under two keys is two ops', () => {
    const i = Interface.define('acme.Db', { get, put: get })
    expect(i.ops.put.name).toBe('put')
    expect(i.ops.put.coord).not.toBe(i.ops.get.coord)
  })
  test('a port is the interface coord and the op name', () => {
    const Log = Interface.define('acme.Log', { record: Op.action(Num, Nothing) })
    expect(port(Log, Log.ops.record)).toBe('acme.Log/record')
  })
  test('Client types an action as a promise of a result', () => {
    const i = Interface.define('acme.Db', { get })
    const c: Client<typeof i> = { get: async (s: string) => success(s.length) }
    expect(Object.keys(c)).toEqual(['get'])
  })
  test('Client has no key for an event', () => {
    const i = Interface.define('acme.Db', { get, tick: Op.event(Num) })
    const c: Client<typeof i> = { get: async (s: string) => success(s.length) }
    // @ts-expect-error events are not callable
    void c.tick
    expect(Object.keys(c)).toEqual(['get'])
  })
})
