import { expect, test } from 'bun:test'
import { fail, ok, unwrap } from '@composable/sdk'
import { addDraft, addOp, componentsOf, draftManifest, setOpTypes } from '../src/model/components'
import { checkDoc, emptyEditorDoc } from '../src/model/doc'
import { addField, addRecord, builtins } from '../src/model/types'

test('a draft component becomes a manifest from its type refs', () => {
  const t = unwrap(addField(unwrap(addRecord(builtins(), 'p', 'Person')), 'p', 'name', { type: 'string', array: false }))
  let d = unwrap(addDraft([], { author: 'me', id: 'people' }))
  d = unwrap(addOp(d, { author: 'me', id: 'people' }, 'create'))
  d = unwrap(setOpTypes(d, { author: 'me', id: 'people' }, 'create', { input: { type: 'p', array: false }, output: { type: 'p', array: false } }))
  expect(unwrap(draftManifest(d[0], t)).ops[0]).toMatchObject({ name: 'me/people/create', input: { $id: 'Person' }, output: { $id: 'Person' } })
})

test('a live component with a draft\'s id wins, and the draft is marked implemented', () => {
  const live = { id: 'p1', manifest: { id: { author: 'me', id: 'people' }, ops: [] } }
  const out = componentsOf(unwrap(addDraft([], { author: 'me', id: 'people' })), builtins(), [live])
  expect(out).toEqual([{ manifest: live.manifest, draft: true, implemented: true }])
})

test('checkDoc names the first problem and accepts a round-tripped doc', () => {
  expect(checkDoc({ types: [], components: [] }).type).toBe('error')
  const bad = { ...emptyEditorDoc(), types: [...builtins(), { id: 'r', kind: 'record', name: 'R', fields: [{ name: 'x', ref: { type: 'ghost', array: false } }] }] }
  expect(checkDoc(bad)).toEqual(fail('validation', 'R.x refers to unknown type ghost'))
  expect(checkDoc(JSON.parse(JSON.stringify(emptyEditorDoc())))).toEqual(ok(emptyEditorDoc()))
})
