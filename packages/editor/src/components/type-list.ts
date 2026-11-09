// The named types: built-ins first, then the ones made here. Selecting one hands it, with its look, to whoever listens.
import { Type } from 'typebox'
import { component, event, state } from '@composable/runes'
import { brandOf, builtins, isBuiltin, titleOf, type TypeEntry } from '../model'

/** The list of types, and which one is selected (by title). */
export const TypeList = component('composable.editor/type-list', () => {
  const s = state({ custom: [] as TypeEntry[], selected: undefined as string | undefined })
  const typeSelected = event()
  const all = () => [...builtins(), ...s.custom]
  const find = (title: string) => {
    const e = all().find(e => titleOf(e.type) === title)
    if (!e) throw new Error(`no type ${title}`)
    return e
  }
  const fresh = (title: string) => { if (all().some(e => titleOf(e.type) === title)) throw new Error(`${title} already exists`) }
  const mine = (title: string) => { if (isBuiltin(title)) throw new Error(`${title} is built in`); find(title) }
  return {
    get types() { return all() },
    get selected() { return s.selected },
    typeSelected,
    set: (entries: TypeEntry[]) => {
      s.custom = entries.filter(e => !isBuiltin(titleOf(e.type)))
      if (s.selected !== undefined) { s.selected = undefined; typeSelected(null) }   // whoever edits it lets go
    },
    add: (title: string) => { fresh(title); s.custom.push({ type: Type.Object({}, { title }) }) },
    rename: ({ from, to }: { from: string; to: string }) => {
      mine(from); fresh(to)
      const e = s.custom.find(e => titleOf(e.type) === from)!
      e.type = { ...e.type, title: to }
      if (s.selected === from) { s.selected = to; typeSelected(e) }
    },
    copyAsBrand: ({ from, to }: { from: string; to: string }) => { fresh(to); s.custom.push({ type: brandOf(find(from).type, to) }) },
    remove: (title: string) => {
      mine(title)
      s.custom = s.custom.filter(e => titleOf(e.type) !== title)
      if (s.selected === title) { s.selected = undefined; typeSelected(null) }
    },
    select: (title: string) => { const e = find(title); s.selected = title; typeSelected(e) },
    /** Takes back an edited type: replaces the entry with the same title. */
    update: (entry: TypeEntry) => {
      const title = titleOf(entry.type)
      mine(title)
      s.custom = s.custom.map(e => (titleOf(e.type) === title ? entry : e))
    },
  }
})
