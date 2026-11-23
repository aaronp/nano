import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Schema } from '../src/schema.ts'
import { Op } from '../src/op.ts'
import { Interface } from '../src/iface.ts'
import { Coord } from '../src/coord.ts'
import { matches, selectorData, type Target } from '../src/selector.ts'

const Str = Schema.define(Type.String(), 'Str')
const acme = Coord.namespace('acme')
const db = Interface.define(acme.interfaceId('Db'), { get: Op.action(Str, Str) })
const [Db, Log] = [acme.interfaceId('Db'), acme.interfaceId('Log')]
const [memDb, sqlDb] = [Coord.namespace('acme/mem').implementationId('db'), Coord.namespace('acme/sql').implementationId('db')]
const target: Target = {
  name: 'db', runtime: 'v3', implementation: 'acme/mem/db', provider: 'acme/mem',
  provides: new Set(['acme.Db']), tags: new Set(['primary', 'fast']),
}

describe('selectors', () => {
  test('an interface selects what provides it', () => {
    expect(String(selectorData(db).implements)).toBe('acme.Db')
    expect(matches(selectorData(db), target)).toBe(true)
    expect(matches({ implements: Log }, target)).toBe(false)
  })
  test('tags must all be present', () => {
    expect(matches({ tags: ['primary', 'fast'] }, target)).toBe(true)
    expect(matches({ tags: ['primary', 'cache'] }, target)).toBe(false)
  })
  test('implementation and provider narrow it', () => {
    expect(matches({ implements: Db, implementation: memDb, provider: memDb.ns }, target)).toBe(true)
    expect(matches({ implements: Db, implementation: sqlDb }, target)).toBe(false)
    expect(matches({ implements: Db, provider: sqlDb.ns }, target)).toBe(false)
  })
  test('runtime narrows it to the runtime the target is reached in', () => {
    expect(matches({ runtime: Coord.runtime('v2') }, target)).toBe(false)
    expect(matches({ runtime: Coord.runtime('v2') }, { ...target, runtime: 'v2' })).toBe(true)
  })
})
