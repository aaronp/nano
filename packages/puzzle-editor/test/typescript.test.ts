import { expect, test } from 'bun:test'
import { unwrap } from '@composable/sdk'
import { addBrand, addField, addRecord, builtins } from '../src/model/types'
import { parseTypes, printTypes } from '../src/model/typescript'

test('print and parse round-trip records, arrays and brands, keeping ids', () => {
  let t = unwrap(addRecord(builtins(), 'a', 'Address'))
  t = unwrap(addField(t, 'a', 'city', { type: 'string', array: false }))
  t = unwrap(addBrand(t, 'e', 'Email', 'string'))
  t = unwrap(addField(t, 'a', 'mail', { type: 'e', array: true }))
  const src = printTypes(t)
  expect(src).toContain('type Address = {')
  expect(src).toContain('  mail: Email[];')
  expect(src).toContain('type Email = string; // brand')
  const back = parseTypes(src, t, () => 'new')
  expect(back).toEqual({ ok: true, types: t })
})

test('a typo gives line-numbered errors and no change', () => {
  const r = parseTypes('type A = {\n  x: Strin;\n}', builtins(), () => 'n')
  expect(r).toEqual({ ok: false, errors: ['Line 2: unknown type Strin'] })
})

test('new types get new ids, missing ones are removed, garbage never throws', () => {
  const t = unwrap(addBrand(builtins(), 'e', 'Email', 'string'))
  const r = parseTypes('type B = number; // brand', t, () => 'n1')
  expect(r.ok && r.types.map(x => x.id)).toEqual(['string', 'number', 'boolean', 'n1'])
  expect(parseTypes('}{ @@ ;;', t, () => 'n').ok).toBe(false)
})
