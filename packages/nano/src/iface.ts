/**
 * Interfaces: a coordinate plus a set of ops, indexed by name and by op coord. A port is one op as offered by one
 * interface, written readably.
 *
 *   const db = Interface.define('acme/db', { get: Op.action('get', Key, Value) })
 *   port(db, db.ops.get)   // 'acme/db/get'
 */
import type { Static, TSchema } from 'typebox'
import type { Op } from './op.ts'
import type { NanoResult } from './result.ts'

export type Interface<Ops extends Record<string, Op> = Record<string, Op>> = {
  readonly coord: string
  readonly ops: Ops
  readonly byCoord: ReadonlyMap<string, Op>
}

export const COORD = /^[a-zA-Z][a-zA-Z0-9-]*([./][a-zA-Z0-9-]+)+$/

/** A port: `<interface>/<op name>`. Handlers are keyed by it; op hashes only check that two ports fit. */
export const port = (i: Interface, o: Op): string => `${i.coord}/${o.name}`

function define<Ops extends Record<string, Op>>(coord: string, ops: Ops): Interface<Ops> {
  if (!COORD.test(coord)) throw new Error(`bad interface coordinate ${coord}`)
  for (const [key, o] of Object.entries(ops)) if (o.name !== key) throw new Error(`${coord}: op ${key} is named ${o.name}`)
  return { coord, ops, byCoord: new Map(Object.values(ops).map(o => [o.coord, o])) }
}

type Data<D> = NonNullable<D> extends { schema: infer S extends TSchema } ? Static<S> : never

/** Typed caller for an interface: each action is an async function. Events have none: they are published. */
export type Client<I extends Interface> = {
  [K in keyof I['ops'] as I['ops'][K]['kind'] extends 'event' ? never : K]: (input: Data<I['ops'][K]['input']>) => Promise<NanoResult<Data<I['ops'][K]['output']>>>
}

/** `Interface.define(coord, ops)`. */
export const Interface = { define }
