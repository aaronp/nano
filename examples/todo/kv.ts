/**
 * A key/value store: keys are paths, values are JSON. The plain interface and the nano interface share a name; the
 * in-memory store is plain TypeScript, lifted into nano by `handlers`.
 *
 *   const s = inMemory(); await s.put({ key: ['todos', '1'], value: { title: 'milk' } })
 *   await s.list({ prefix: ['todos'] })   // [{ key: ['todos', '1'], value: { title: 'milk' } }]
 */
import { Type, type Static } from 'typebox'
import { Schema, Interface, Implementation, Op, provide, Provider } from '@pritzlaff/nano-core'
import { handlers, type Matches } from './plain.ts'

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

// Each schema once; its TypeScript type is derived from it, under the same name.
export const Path = Schema.define('Path', Type.Array(Type.String()))
export type Path = Static<typeof Path.schema>
/** Any value to nano's check; `Json` to TypeScript. */
export const Value = Schema.define('Value', Type.Unsafe<Json>(Type.Unknown()))
export const Entry = Schema.define('Entry', Type.Object({ key: Path.schema, value: Value.schema }))
export type Entry = Static<typeof Entry.schema>
const Done = Schema.define('Done', Type.Null())

export interface KeyValueStore {
  /** `null` when the key is missing. */
  get(key: Path): Promise<Json | null>
  put(e: Entry): Promise<void>
  delete(key: Path): Promise<void>
  /** Every entry under `prefix`, ordered by path. */
  list(q: { prefix: Path }): Promise<Entry[]>
}

export const KeyValueStore = Interface.define('example.kv.KeyValueStore', {
  get: Op.action('get', Path, Value),
  put: Op.action('put', Entry, Done),
  delete: Op.action('delete', Path, Done),
  list: Op.action('list', Schema.define('Prefix', Type.Object({ prefix: Path.schema })), Schema.define('Entries', Type.Array(Entry.schema))),
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

const memory = Implementation.define('example.kv/memory', {
  provides: [KeyValueStore],
  description: 'Keeps entries in memory; a restart empties it.',
  make: () => [provide(KeyValueStore, handlers(KeyValueStore, inMemory()))],
})

export default Provider.define('example.kv', [memory])

true satisfies Matches<KeyValueStore, typeof KeyValueStore>
