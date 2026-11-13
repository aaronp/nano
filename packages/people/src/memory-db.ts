// Storage you can see: a Db kept in memory, its entries published for the DB view.
import { Type } from 'typebox'
import { component, state } from '@pritzlaff/nano-runes'
import { Db, ok } from './interfaces'

export type Entry = { key: string; value: unknown }

export const MemoryDb = component('composable.people/memory-db', () => {
  const s = state({ entries: [] as Entry[] })
  const at = (key: string) => s.entries.find(e => e.key === key)
  return {
    get entries() { return s.entries },
    save: ({ key, value }: Entry) => { const e = at(key); if (e) e.value = value; else s.entries.push({ key, value }); return ok(key) },
    load: (key: string) => at(key)?.value ?? null,
    keys: () => s.entries.map(e => e.key),
  }
}, {
  entries: Type.Array(Type.Object({ key: Type.String(), value: Type.Unknown() }), { description: 'Everything stored, oldest first' }),
}, { implements: Db, description: 'A Db in memory, showing what it holds' })
