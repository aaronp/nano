/**
 * Two in-memory stores: `memory`, and `backup`, a second one to swap to (each pod has its own data; a restart empties
 * it back to its config, `{ entries }`, if any). The store itself is plain TypeScript; nano lifts the plain object `make` returns.
 *
 *   const s = inMemory(); await s.put({ key: ['a'], value: 1 }); await s.get(['a'])   // 1
 *   Pod.eager(memory, { config: { entries: [{ key: ['a'], value: 1 }] } })              // starts holding a
 */
import { Type } from 'typebox'
import { KeyValueStoreDef } from './contract.ts'

type Path = KeyValueStoreDef.Path
type Entry = KeyValueStoreDef.Entry

/** Shorter paths first, then segment by segment. */
export const order = (a: Path, b: Path): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1
  return a.length - b.length
}

/** A store in a Map, starting with `entries` (a later one wins): plain CRUD. Who hears a put is the runtime's business, not the store's. */
export function inMemory(entries: Entry[] = []): KeyValueStoreDef.KeyValueStore {
  const data = new Map<string, Entry>(entries.map(e => [JSON.stringify(e.key), structuredClone(e)]))   // by JSON of the path
  return {
    async get(key) { const e = data.get(JSON.stringify(key)); return e ? structuredClone(e.value) : null },
    async put({ key, value }) { data.set(JSON.stringify(key), structuredClone({ key, value })) },
    async delete(key) { data.delete(JSON.stringify(key)) },
    async list({ prefix }) {
      return [...data.values()].filter(e => prefix.every((p, i) => e.key[i] === p)).sort((a, b) => order(a.key, b.key)).map(e => structuredClone(e))
    },
  }
}

const { api, ns } = KeyValueStoreDef
export const impls = { memory: ns.implementationId('memory'), backup: ns.implementationId('backup') }
/** Optional: the entries a store starts with. */
const Config = Type.Union([Type.Object({ entries: Type.Optional(Type.Array(KeyValueStoreDef.Entry)) }), Type.Undefined()])
const memory = api.impl(impls.memory).config(Config).description('Keeps entries in memory; a restart empties it back to its config.').make(({ config }) => inMemory(config?.entries))
const backup = api.impl(impls.backup).config(Config).description('A second in-memory store, to swap to.').make(({ config }) => inMemory(config?.entries))

export default ns.provider([memory, backup])
