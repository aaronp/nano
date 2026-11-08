import { expect, test } from 'bun:test'
import { fail, ok } from '@composable/sdk'
import { checkDoc, emptyEditorDoc } from '../src/model/doc'
import { builtins } from '../src/model/types'

test('checkDoc names the first problem and accepts a round-tripped doc', () => {
  expect(checkDoc({ types: [], components: [] }).type).toBe('error')
  const bad = { ...emptyEditorDoc(), types: [...builtins(), { id: 'r', kind: 'record', name: 'R', fields: [{ name: 'x', ref: { type: 'ghost', array: false } }] }] }
  expect(checkDoc(bad)).toEqual(fail('validation', 'R.x refers to unknown type ghost'))
  expect(checkDoc(JSON.parse(JSON.stringify(emptyEditorDoc())))).toEqual(ok(emptyEditorDoc()))
})

test('checkDoc rejects hostile shapes without throwing', () => {
  const rec = { id: 'r', kind: 'record', name: 'R', fields: [] }
  const withTypes = (...extra: unknown[]) => ({ ...emptyEditorDoc(), types: [...builtins(), ...extra] })
  const withComps = (...c: unknown[]) => ({ ...emptyEditorDoc(), components: c })
  const id = { author: 'a', id: 'b' }
  for (const doc of [
    withTypes(rec, null),
    withTypes({ id: 'r', kind: 'record', name: 'R' }),
    withTypes({ ...rec, fields: [null] }),
    withTypes({ ...rec, fields: [{ name: 'x', ref: null }] }),
    withTypes({ id: 'b', kind: 'brand', name: 'B' }),
    withComps(null),
    withComps({ id }),
    withComps({ id, ops: [null] }),
  ]) expect(checkDoc(doc).type).toBe('error')
})
