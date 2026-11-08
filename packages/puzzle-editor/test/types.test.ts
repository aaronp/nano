import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { fail, typeHash, unwrap } from '@composable/sdk'
import { addBrand, addField, addRecord, builtins, remove, rename, saidOf, schemaOf, setLook } from '../src/model/types'
import { lookOf, movePoint, presetShape, removeAnchor, splitSegment, SWATCHES } from '../src/model/looks'

test('a record is a named object; a brand is a named copy; arrays of either', () => {
  let t = builtins()
  t = unwrap(addRecord(t, 'addr', 'Address'))
  t = unwrap(addField(t, 'addr', 'city', { type: 'string', array: false }))
  t = unwrap(addBrand(t, 'email', 'Email', 'string'))
  t = unwrap(addField(t, 'addr', 'contacts', { type: 'email', array: true }))
  expect(unwrap(schemaOf('addr', t))).toEqual(Type.Object({ city: Type.String(), contacts: Type.Array(Type.String({ $id: 'Email' })) }, { $id: 'Address' }))
})

test('edits and renames follow by id; dependent SAIDs change; a custom look survives an edit', () => {
  let t = unwrap(addRecord(builtins(), 'addr', 'Address'))
  t = unwrap(addField(t, 'addr', 'city', { type: 'string', array: false }))
  t = unwrap(addRecord(t, 'cust', 'Customer'))
  t = unwrap(addField(t, 'cust', 'home', { type: 'addr', array: false }))
  t = unwrap(setLook(t, 'addr', { ...lookOf(unwrap(saidOf('addr', t))), colour: '#5ED6B4' }))
  const before = unwrap(saidOf('cust', t))
  t = unwrap(rename(t, 'addr', 'PostalAddress'))
  expect(unwrap(saidOf('cust', t))).not.toBe(before)
  expect((unwrap(schemaOf('cust', t)) as any).properties.home.$id).toBe('PostalAddress')
  expect(t.find(x => x.id === 'addr')).toMatchObject({ look: { colour: '#5ED6B4' } })
})

test('removing a used type, dangling refs and brand loops are errors, not throws', () => {
  let t = unwrap(addRecord(builtins(), 'a', 'A'))
  t = unwrap(addField(t, 'a', 'x', { type: 'string', array: false }))
  expect(remove(t, 'string')).toEqual(fail('validation', 'string is used by A'))
  expect(schemaOf('nope', t).type).toBe('error')
  const b = unwrap(addBrand(unwrap(addBrand(builtins(), 'p', 'P', 'string')), 'q', 'Q', 'p'))
  const loop = b.map(x => x.id === 'p' ? { ...x, of: 'q' } : x) as typeof b
  expect(schemaOf('q', loop)).toEqual(fail('validation', 'brands refer to each other in a loop'))
})

test('looks: deterministic from the SAID, distinct per type, presets and point edits keep the ends on the edge', () => {
  const said = typeHash(Type.String())
  expect(lookOf(said)).toEqual(lookOf(said))
  expect(lookOf(said)).not.toEqual(lookOf(typeHash(Type.Number())))
  expect(SWATCHES).toHaveLength(12)
  const s = splitSegment(presetShape('jigsaw'), 0)
  expect(s.segs.length).toBe(presetShape('jigsaw').segs.length + 1)
  expect(removeAnchor(s, 1).segs.length).toBe(presetShape('jigsaw').segs.length)
})

test('movePoint keeps the end anchors on the edge, and mirrors the opposite handle when asked', () => {
  const s = presetShape('dome'), n = s.segs.length   // anchor 1 is at [60, 28]
  expect(movePoint(s, { kind: 'anchor', index: 0 }, [30, 20]).start).toEqual([30, 0])
  expect(movePoint(s, { kind: 'anchor', index: n }, [90, 15]).segs[n - 1]!.p).toEqual([90, 0])
  expect(movePoint(s, { kind: 'anchor', index: 1 }, [60, 20]).segs[0]!.p).toEqual([60, 20])   // a middle one moves freely
  const m = movePoint(s, { kind: 'c1', index: 1 }, [70, 30], true)
  expect(m.segs[1]!.c1).toEqual([70, 30])
  expect(m.segs[0]!.c2).toEqual([50, 26])   // reflected through [60, 28]
  expect(movePoint(s, { kind: 'c1', index: 1 }, [70, 30]).segs[0]!.c2).toEqual(s.segs[0]!.c2)   // not without mirror
})
