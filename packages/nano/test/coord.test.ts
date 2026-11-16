import { describe, expect, test } from 'bun:test'
import { Coord, Implementation, Interface } from '../src/index.ts'

describe('Coord', () => {
  const kv = Coord.namespace('example.kv')
  const store = kv.interface('KeyValueStore')
  const memory = Coord.namespace('aws.kv').implementation('dynamo')

  test('each kind layers on the one before and formats as today\'s string', () => {
    expect(String(kv)).toBe('example.kv')
    expect(String(store)).toBe('example.kv.KeyValueStore')
    expect(String(memory)).toBe('aws.kv/dynamo')
    expect(String(Coord.port(store, 'get'))).toBe('example.kv.KeyValueStore/get')
    expect(String(Coord.pod(memory, 'main', 'store'))).toBe('aws.kv/dynamo@main/store')
    expect(store.ns).toBe(kv)
    expect(Coord.pod(memory, 'main', 'store').implementation).toBe(memory)
  })

  test('parse reads each kind back to an equal coordinate', () => {
    for (const c of [kv, store, memory, Coord.port(store, 'get'), Coord.pod(memory, 'main', 'store')])
      expect(String(Coord.parse(c.kind, String(c)))).toBe(String(c))
    expect(Coord.parse('port', 'example.kv.KeyValueStore/get').interface.name).toBe('KeyValueStore')
  })

  test('the kind decides how a string reads: a port string is not an interface', () => {
    expect(Coord.parse('implementation', 'example.kv.KeyValueStore/get').name).toBe('get')
    expect(() => Coord.parse('interface', 'example.kv/memory')).toThrow('bad interface coordinate')
  })

  test('bad parts throw', () => {
    expect(() => Coord.namespace('9kv')).toThrow('bad namespace')
    expect(() => kv.interface('Key Value')).toThrow('bad name')
    expect(() => Coord.pod(memory, 'main', '')).toThrow('bad pod')
    expect(() => Coord.parse('pod', 'aws.kv/dynamo')).toThrow('bad pod coordinate')
  })

  test('the builders take a coordinate or its string', () => {
    const i = Interface.define(store, {})
    expect(i.coord).toBe('example.kv.KeyValueStore')
    expect(Implementation.define(memory, { provides: [], make: () => [] }).coord).toBe('aws.kv/dynamo')
  })
})
