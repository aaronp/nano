import Type, { type TSchema } from 'typebox'
import { Components, fail, ok, typeHash, type Result, type SystemInstance } from '@composable/sdk'
import {
  addBrand, addField, addRecord, effectiveLook, remove, removeField, rename, schemaOf, setLook,
  type EditorType, type Look,
} from '../model'
import { parseTypes } from '../model/typescript'
import { any, Ref } from './schemas'

export type TypesUpdated = { types: EditorType[]; derived: { id: string; said: string; schema: TSchema; look: Look }[] }

const Types = any<EditorType[]>()

const C = Components.declare({ author: 'composable', id: 'type-editor' })
export const TypeEditorOps = {
  setTypes: C.op('set-types', 'Replace the built-in and draft types (live types stay)', { input: Types }),
  setLiveTypes: C.op('set-live-types', 'Replace the live types, read-only, from live manifests', { input: any<TSchema[]>() }),
  addRecord: C.op('add-record', 'Add an empty record type', { input: Type.Object({ id: Type.String(), name: Type.String() }), output: Types }),
  addField: C.op('add-field', 'Add a field to a record', { input: Type.Object({ record: Type.String(), name: Type.String(), ref: Ref }), output: Types }),
  removeField: C.op('remove-field', 'Remove a field from a record', { input: Type.Object({ record: Type.String(), name: Type.String() }), output: Types }),
  addBrand: C.op('add-brand', 'Add a brand of another type', { input: Type.Object({ id: Type.String(), name: Type.String(), of: Type.String() }), output: Types }),
  rename: C.op('rename', 'Rename a record or brand', { input: Type.Object({ id: Type.String(), name: Type.String() }), output: Types }),
  remove: C.op('remove', 'Delete a type nothing uses', { input: Type.Object({ id: Type.String() }), output: Types }),
  setLook: C.op('set-look', 'Give a record or brand its own look', { input: Type.Object({ id: Type.String(), look: any<Look>() }), output: Types }),
  setCode: C.op('set-code', 'Replace the draft types from TypeScript source', { input: Type.Object({ source: Type.String() }), output: Types }),
  typesUpdated: C.op('types-updated', 'All types, with derived schemas, SAIDs and looks', { output: any<TypesUpdated>() }),
}
const o = TypeEditorOps

type State = { types: EditorType[] }

const derive = (types: EditorType[]): TypesUpdated => ({
  types,
  derived: types.flatMap(t => {
    const r = schemaOf(t.id, types)
    if (r.type !== 'success') return []
    const said = typeHash(r.data)
    return [{ id: t.id, said, schema: r.data, look: effectiveLook(t, said) }]
  }),
})

const set = async (state: State, system: SystemInstance, types: EditorType[]) => {
  state.types = types
  await system.notify(o.typesUpdated, derive(types))
}
/** Apply an edit: on success keep and announce it; either way, its Result. */
const edit = async (r: Result<EditorType[]>, state: State, system: SystemInstance) => {
  if (r.type === 'success') await set(state, system, r.data)
  return r
}

export const typeEditor = C.define({
  state: (): State => ({ types: [] }),
  handlers: [
    [o.setTypes, (types, { state, system }) => set(state, system, [...types, ...state.types.filter(t => t.kind === 'live')])],
    [o.setLiveTypes, (schemas, { state, system }) => set(state, system, [
      ...state.types.filter(t => t.kind !== 'live'),
      ...schemas.map(schema => ({ id: typeHash(schema), kind: 'live' as const, schema })),
    ])],
    [o.addRecord, ({ id, name }, { state, system }) => edit(addRecord(state.types, id, name), state, system)],
    [o.addField, ({ record, name, ref }, { state, system }) => edit(addField(state.types, record, name, ref), state, system)],
    [o.removeField, ({ record, name }, { state, system }) => edit(removeField(state.types, record, name), state, system)],
    [o.addBrand, ({ id, name, of }, { state, system }) => edit(addBrand(state.types, id, name, of), state, system)],
    [o.rename, ({ id, name }, { state, system }) => edit(rename(state.types, id, name), state, system)],
    [o.remove, ({ id }, { state, system }) => edit(remove(state.types, id), state, system)],
    [o.setLook, ({ id, look }, { state, system }) => edit(setLook(state.types, id, look), state, system)],
    [o.setCode, ({ source }, { state, system }) => {
      const r = parseTypes(source, state.types, () => crypto.randomUUID())
      return edit(r.ok ? ok(r.types) : fail('validation', r.errors.join('; ')), state, system)
    }],
  ],
})
