import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface } from '../src/iface.ts'
import { matches, selectorData, type Target } from '../src/selector.ts'

const Str = defineSchema('Str', Type.String())
const db = iface('acme/db', { get: op.action('get', Str, Str) })
const target: Target = {
  instance: 'acme/mem/db#1', implementation: 'acme/mem/db', provider: 'acme/mem',
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
})
