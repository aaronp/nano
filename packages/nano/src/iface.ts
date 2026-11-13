/**
 * Interfaces: a coordinate plus a set of ops, indexed by name and by op coord.
 *
 *   const db = iface('acme/db', { get: op.action('get', Key, Value) })
 *   db.byCoord.get(db.ops.get.coord)   // the op
 */
import type { Static, TSchema } from 'typebox'
import type { Op } from './op.ts'
import type { NanoResult } from './result.ts'

export type Interface<Ops extends Record<string, Op> = Record<string, Op>> = {
  readonly coord: string
  readonly ops: Ops
  readonly byCoord: ReadonlyMap<string, Op>
}

const COORD = /^[a-zA-Z][a-zA-Z0-9-]*([./][a-zA-Z0-9-]+)+$/

export function iface<Ops extends Record<string, Op>>(coord: string, ops: Ops): Interface<Ops> {
  if (!COORD.test(coord)) throw new Error(`bad interface coordinate ${coord}`)
  for (const [key, o] of Object.entries(ops)) if (o.name !== key) throw new Error(`${coord}: op ${key} is named ${o.name}`)
  return { coord, ops, byCoord: new Map(Object.values(ops).map(o => [o.coord, o])) }
}

type ISchema<D> = D extends { schema: infer S } ? S : never
// [X] extends [never]: a sink's output is absent (never), so it yields void rather than distributing.
type Out<O extends Op> = [ISchema<O['output']>] extends [never] ? void : NonNullable<O['output']> extends { schema: infer S extends TSchema } ? Static<S> : void

/** Typed caller for an interface: each action or sink is an async function. */
export type Client<I extends Interface> = {
  [K in keyof I['ops'] as I['ops'][K]['kind'] extends 'source' ? never : K]: NonNullable<I['ops'][K]['input']> extends { schema: infer S extends TSchema }
    ? (input: Static<S>) => Promise<NanoResult<Out<I['ops'][K]>>>
    : never
}
