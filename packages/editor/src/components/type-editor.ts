// Edits one type: its fields (for a record) and its look. Takes a TypeEntry in, publishes the edited one.
import type { TSchema } from 'typebox'
import { component, event, state } from '@composable/runes'
import type { Look, TypeEntry } from '../model'

type Record_ = TSchema & { title?: string; type: 'object'; properties: Record<string, TSchema>; required?: string[] }

/** The type being edited, and every change to it as `typeChanged`. */
export const TypeEditor = component('composable.editor/type-editor', () => {
  const s = state({ entry: undefined as TypeEntry | undefined })
  const typeChanged = event()
  const loaded = () => { if (!s.entry) throw new Error('no type is being edited'); return s.entry }
  const record = () => {
    const t = loaded().type as Record_
    if (t.type !== 'object') throw new Error(`${String(t.title)} is not a record`)
    return t
  }
  const changed = () => typeChanged(s.entry!)
  return {
    get entry() { return s.entry },
    typeChanged,
    edit: (entry: TypeEntry) => { s.entry = entry },
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
})
