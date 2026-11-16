/**
 * A key/value store: keys are paths, values are JSON. The plain interface and the nano interface share a name; the
 * in-memory store is plain TypeScript, lifted into nano by `handlers`.
 *
 *   const s = inMemory(); await s.put({ key: ['todos', '1'], value: { title: 'milk' } })
 *   await s.list({ prefix: ['todos'] })   // [{ key: ['todos', '1'], value: { title: 'milk' } }]
 */
import { Type } from 'typebox'
import { defineSchema, iface, implementation, op, provide, provider } from '@pritzlaff/nano-core'
import { handlers } from './plain.ts'

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
export type Path = string[]
export type Entry = { key: Path; value: Json }

export interface KeyValueStore {
  /** `null` when the key is missing. */
  get(key: Path): Promise<Json | null>
  put(e: Entry): Promise<void>
  delete(key: Path): Promise<void>
  /** Every entry under `prefix`, ordered by path. */
  list(q: { prefix: Path }): Promise<Entry[]>
}

const PathS = defineSchema('Path', Type.Array(Type.String()))
const ValueS = defineSchema('Value', Type.Unknown())
const EntryS = defineSchema('Entry', Type.Object({ key: PathS.schema, value: ValueS.schema }))
const Done = defineSchema('Done', Type.Null())

export const KeyValueStore = iface('example.kv.KeyValueStore', {
  get: op.action('get', PathS, ValueS),
  put: op.action('put', EntryS, Done),
  delete: op.action('delete', PathS, Done),
  list: op.action('list', defineSchema('Prefix', Type.Object({ prefix: PathS.schema })), defineSchema('Entries', Type.Array(EntryS.schema))),
})

/** Shorter paths first, then segment by segment. */
const order = (a: Path, b: Path): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1
  return a.length - b.length
}

export function inMemory(): KeyValueStore {
  const data = new Map<string, Entry>()   // by JSON of the path
  return {
    async get(key) { const e = data.get(JSON.stringify(key)); return e ? structuredClone(e.value) : null },
    async put({ key, value }) { data.set(JSON.stringify(key), structuredClone({ key, value })) },
    async delete(key) { data.delete(JSON.stringify(key)) },
    async list({ prefix }) {
      return [...data.values()].filter(e => prefix.every((p, i) => e.key[i] === p)).sort((a, b) => order(a.key, b.key)).map(e => structuredClone(e))
    },
  }
}

const memory = implementation('example.kv/memory', {
  provides: [KeyValueStore],
  description: 'Keeps entries in memory; a restart empties it.',
  make: () => [provide(KeyValueStore, handlers(KeyValueStore, inMemory()))],
})

export default provider('example.kv', [memory])
