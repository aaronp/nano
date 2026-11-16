/**
 * The key/value store contract: keys are paths, values are JSON. No implementation code; this is what other teams
 * import. `KeyValueStoreDef.KeyValueStore` is the plain TypeScript interface, derived from `api`.
 *
 *   const s: KeyValueStoreDef.KeyValueStore = app.runtime('backend').get(KeyValueStoreDef.api)
 *   await s.put({ key: ['todos', '1'], value: { title: 'milk' } }); await s.list({ prefix: ['todos'] })
 */
import { Type, type Static } from 'typebox'
import { Coord, Interface, Op, Schema } from '@pritzlaff/nano-core'

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

export namespace KeyValueStoreDef {
  export const ns = Coord.namespace('example.kv')

  export const Path = Schema.define(Type.Array(Type.String()))
  export type Path = Static<typeof Path>
  /** Any value to nano's check; `Json` to TypeScript. */
  export const Value = Schema.define(Type.Unsafe<Json>(Type.Unknown()))
  export const Entry = Schema.define(Type.Object({ key: Path, value: Value }))
  export type Entry = Static<typeof Entry>

  export const api = ns.interface('KeyValueStore', {
    /** `null` when the key is missing. */
    get: Op.action(Path, Value),
    put: Op.action(Entry, Type.Null()),
    delete: Op.action(Path, Type.Null()),
    /** Every entry under `prefix`, ordered by path. */
    list: Op.action(Type.Object({ prefix: Path }), Type.Array(Entry)),
  })
  export type KeyValueStore = Interface.Type<typeof api>
}
