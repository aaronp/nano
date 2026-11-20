import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Coord, Implementation, Interface, Op, Provider, Registry, Schema, Selector } from '../src/index.ts'
import { matches, selectorData, type Target } from '../src/selector.ts'

const acme = Coord.namespace('acme')
const mem = acme.implementationId('mem')
const Str = Schema.define(Type.String(), 'Str')
const DB = acme.interface('DB', { get: Op.action(Str, Str) })

describe('RuntimeCoord', () => {
  test('Coord.runtime checks the id rule; its string is the id; parse reads it back', () => {
    const v2 = Coord.runtime('v2')
    expect([v2.kind, v2.id, String(v2)]).toEqual(['runtime', 'v2', 'v2'])
    expect(String(Coord.parse('runtime', 'v2'))).toBe('v2')
    for (const bad of ['', 'a/b', 'a@b', 'a b', 'x'.repeat(65)]) expect(() => Coord.runtime(bad)).toThrow('bad runtime')
    expect(() => Coord.parse('runtime', 'a@b')).toThrow('bad runtime coordinate')
  })

  test('a pod coordinate holds a RuntimeCoord; its string form is unchanged', () => {
    const p = Coord.pod(mem, Coord.runtime('main'), 'store')
    expect(String(p)).toBe('acme/mem@main/store')
    expect(p.runtime.kind).toBe('runtime')
    const back = Coord.parse('pod', 'acme/mem@main/store')
    expect([String(back.runtime), back.runtime.kind, String(back.implementation), back.pod]).toEqual(['main', 'runtime', 'acme/mem', 'store'])
  })

  test('a coordinate JSON-stringifies as its string', () => {
    expect(JSON.stringify({ r: Coord.runtime('v2'), i: acme.interfaceId('DB') })).toBe('{"r":"v2","i":"acme.DB"}')
  })
})

describe('Interface.define takes only interface coordinates', () => {
  test('the slash form throws, as other bad coordinates do', () => {
    expect(() => Interface.define('acme/db', {})).toThrow('bad interface coordinate acme/db')
    expect(Interface.define('acme.Db', {}).coord).toBe('acme.Db')
  })
})

describe('selectors built from coordinates', () => {
  const target: Target = { name: 'db', runtime: 'v2', implementation: 'acme/mem', provider: 'acme',
    provides: new Set(['acme.DB']), tags: new Set() }

  test('Selector.of narrows by coordinates and matches as before', () => {
    const s = selectorData(Selector.of(DB, { runtime: Coord.runtime('v2'), implementation: mem, provider: acme }))
    expect(s.implements?.kind).toBe('interface')
    expect(String(s.implements)).toBe('acme.DB')
    expect(matches(s, target)).toBe(true)
    expect(matches({ runtime: Coord.runtime('v3') }, target)).toBe(false)
    expect(matches({ implementation: acme.implementationId('sql') }, target)).toBe(false)
  })

  test('the registry manifest writes a selector as strings, and they read back', () => {
    const impl = Implementation.define(acme.implementationId('copy'), {
      provides: [], dependencies: { from: Selector.of(DB, { runtime: Coord.runtime('v2'), implementation: mem, provider: acme, tags: ['t'] }) },
      make: () => [],
    })
    const r = Registry.create()
    r.add(Provider.define(acme, [impl]))
    const deps = r.manifest().implementations[0]!.dependencies
    expect(deps).toEqual({ from: { implements: 'acme.DB', runtime: 'v2', implementation: 'acme/mem', provider: 'acme', tags: ['t'] } })
    expect(String(Coord.parse('interface', deps.from!.implements!))).toBe('acme.DB')
  })
})
