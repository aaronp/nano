/**
 * The key/value store contract: keys are paths, values are JSON. No implementation code; this is what other teams
 * import. `KeyValueStoreDef.KeyValueStore` is the plain TypeScript interface, derived from `api`.
 *
 *   const s: KeyValueStoreDef.KeyValueStore = app.get(KeyValueStoreDef.api)
 *   await s.put({ key: ['todos', '1'], value: { title: 'milk' } }); await s.list({ prefix: ['todos'] })
 */
import { Type, type Static } from 'typebox'
import { Coord, Interface, Op, Schema } from '@pritzlaff/nano-core'

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

export namespace KeyValueStoreDef {
  export const ns = Coord.namespace('example.kv')

  export const Path = Schema.define('Path', Type.Array(Type.String()))
  export type Path = Static<typeof Path.schema>
  /** Any value to nano's check; `Json` to TypeScript. */
  export const Value = Schema.define('Value', Type.Unsafe<Json>(Type.Unknown()))
  export const Entry = Schema.define('Entry', Type.Object({ key: Path.schema, value: Value.schema }))
  export type Entry = Static<typeof Entry.schema>

  export const api = Interface.define(ns.interface('KeyValueStore'), {
    /** `null` when the key is missing. */
    get: Op.action('get', Path, Value),
    put: Op.action('put', Entry, Type.Null()),
    delete: Op.action('delete', Path, Type.Null()),
    /** Every entry under `prefix`, ordered by path. */
    list: Op.action('list', Type.Object({ prefix: Path.schema }), Type.Array(Entry.schema)),
    /** A key was put or deleted. */
    changed: Op.event('changed', Type.Object({ key: Path.schema })),
  })
  export type KeyValueStore = Interface.Type<typeof api>
  export const impls = { memory: ns.implementation('memory'), backup: ns.implementation('backup') }
}
