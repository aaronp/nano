// Edits one type: its fields (for a record) and its look. Takes a TypeEntry in, publishes the edited one.
import { Type, type TSchema } from 'typebox'
import { LookSchema, SchemaSchema, TypeEntrySchema } from './schemas'
import { component, event, state } from '@pritzlaff/nano-runes'
import { isBuiltin, titleOf, type Look, type TypeEntry } from '../model'

type Record_ = TSchema & { title?: string; type: 'object'; properties: Record<string, TSchema>; required?: string[] }

const field = Type.Object({ name: Type.String({ description: 'The field name', examples: ['x'] }), type: SchemaSchema }, { description: 'A field: its name and type' })
const fieldName = Type.String({ description: 'The field name', examples: ['x'] })

/** The type being edited, and every change to it as `typeChanged`. */
export const TypeEditor = component('composable.editor/type-editor', () => {
  const s = state({ entry: undefined as TypeEntry | undefined })
  const typeChanged = event<typeof TypeEntrySchema>()
  const loaded = () => {
    if (!s.entry) throw new Error('no type is being edited')
    if (isBuiltin(titleOf(s.entry.type))) throw new Error(`${titleOf(s.entry.type)} is built in`)
    return s.entry
  }
  const record = () => {
    const t = loaded().type as Record_
    if (t.type !== 'object') throw new Error(`${String(t.title)} is not a record`)
    return t
  }
  const changed = () => typeChanged(s.entry!)
  return {
    get entry() { return s.entry },
    typeChanged,
    /** Loads a type to edit; null lets go of it. */
    edit: (entry: TypeEntry | null) => { s.entry = entry ?? undefined },
    addField: ({ name, type }: { name: string; type: TSchema }) => {
      const r = record()
      if (name in r.properties) throw new Error(`${name} is already a field`)
      r.properties[name] = type
      r.required = [...(r.required ?? []), name]
      changed()
    },
    setField: ({ name, type }: { name: string; type: TSchema }) => {
      const r = record()
      if (!(name in r.properties)) throw new Error(`no field ${name}`)
      r.properties[name] = type
      changed()
    },
    removeField: (name: string) => {
      const r = record()
      if (!(name in r.properties)) throw new Error(`no field ${name}`)
      delete r.properties[name]
      r.required = (r.required ?? []).filter(n => n !== name)
      changed()
    },
    setLook: (look: Look) => { loaded().look = look; changed() },
    resetLook: () => { delete loaded().look; changed() },
  }
}, {
  entry: Type.Optional(TypeEntrySchema),
  typeChanged: TypeEntrySchema,
  edit: { in: Type.Union([TypeEntrySchema, Type.Null()], { description: 'The type to edit, or null to let go' }), description: 'Loads a type to edit' },
  addField: { in: field, description: 'Adds a field to the record being edited' },
  setField: { in: field, description: "Changes a field's type" },
  removeField: { in: fieldName, description: 'Removes a field' },
  setLook: { in: LookSchema, description: "Sets the type's look" },
  resetLook: { description: "Goes back to the type's default look" },
}, { description: 'Edits one type: its fields and its look' })
