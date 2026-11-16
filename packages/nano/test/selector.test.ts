import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Schema } from '../src/schema.ts'
import { Op } from '../src/op.ts'
import { Interface } from '../src/iface.ts'
import { matches, selectorData, type Target } from '../src/selector.ts'

const Str = Schema.define(Type.String(), 'Str')
const db = Interface.define('acme/db', { get: Op.action(Str, Str) })
const target: Target = {
  name: 'db', runtime: 'v3', implementation: 'acme/mem/db', provider: 'acme/mem',
  provides: new Set(['acme/db']), tags: new Set(['primary', 'fast']),
}

describe('selectors', () => {
  test('an interface selects what provides it', () => {
    expect(selectorData(db)).toEqual({ implements: 'acme/db' })
    expect(matches(selectorData(db), target)).toBe(true)
    expect(matches({ implements: 'acme/log' }, target)).toBe(false)
  })
  test('tags must all be present', () => {
    expect(matches({ tags: ['primary', 'fast'] }, target)).toBe(true)
    expect(matches({ tags: ['primary', 'cache'] }, target)).toBe(false)
  })
  test('implementation and provider narrow it', () => {
    expect(matches({ implements: 'acme/db', implementation: 'acme/mem/db', provider: 'acme/mem' }, target)).toBe(true)
    expect(matches({ implements: 'acme/db', implementation: 'acme/sql/db' }, target)).toBe(false)
    expect(matches({ implements: 'acme/db', provider: 'acme/sql' }, target)).toBe(false)
  })
  test('runtime narrows it to the runtime the target is reached in', () => {
    expect(matches({ runtime: 'v2' }, target)).toBe(false)
    expect(matches({ runtime: 'v2' }, { ...target, runtime: 'v2' })).toBe(true)
  })
})
