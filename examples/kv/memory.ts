/**
 * Two in-memory stores: `memory`, and `backup`, a second one to swap to (each pod has its own data; a restart empties
 * it). The store itself is plain TypeScript; nano lifts the plain object `make` returns.
 *
 *   const s = inMemory(); await s.put({ key: ['a'], value: 1 }); await s.get(['a'])   // 1
 */
import { KeyValueStoreDef } from './contract.ts'

type Path = KeyValueStoreDef.Path
type Entry = KeyValueStoreDef.Entry

/** Shorter paths first, then segment by segment. */
const order = (a: Path, b: Path): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1
  return a.length - b.length
}

/** A store in a Map: plain CRUD. Who hears a put is the runtime's business, not the store's. */
export function inMemory(): KeyValueStoreDef.KeyValueStore {
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

const { api, ns } = KeyValueStoreDef
export const impls = { memory: ns.implementationId('memory'), backup: ns.implementationId('backup') }
const memory = api.impl(impls.memory).description('Keeps entries in memory; a restart empties it.').make(() => inMemory())
const backup = api.impl(impls.backup).description('A second in-memory store, to swap to.').make(() => inMemory())

export default ns.provider([memory, backup])
