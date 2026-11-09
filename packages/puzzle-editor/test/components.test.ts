import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { unwrap } from '@composable/sdk'
import { addDraft, addOp, componentsOf, draftManifest, setOpTypes } from '../src/model/components'
import { addField, addRecord, builtins, remove } from '../src/model/types'

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

test('an array ref becomes Type.Array in the manifest', () => {
  let d = unwrap(addOp(unwrap(addDraft([], { author: 'me', id: 'c' })), { author: 'me', id: 'c' }, 'list'))
  d = unwrap(setOpTypes(d, { author: 'me', id: 'c' }, 'list', { output: { type: 'string', array: true } }))
  expect(unwrap(draftManifest(d[0], builtins())).ops[0].output).toEqual(Type.Array(Type.String()))
})

test('a draft whose type was removed stays listed with a problem and its good ops', () => {
  const id = { author: 'me', id: 'c' }
  const t = unwrap(addRecord(builtins(), 'p', 'Person'))
  let d = unwrap(addOp(unwrap(addOp(unwrap(addDraft([], id)), id, 'a')), id, 'b'))
  d = unwrap(setOpTypes(d, id, 'a', { output: { type: 'p', array: false } }))
  d = unwrap(setOpTypes(d, id, 'b', { output: { type: 'string', array: false } }))
  const [e] = componentsOf(d, unwrap(remove(t, 'p')), [])
  expect(e).toMatchObject({ draft: true, implemented: false, problem: 'me/c/a output: unknown type p' })
  expect(e.manifest.ops.map(o => o.name)).toEqual(['me/c/b'])
})
