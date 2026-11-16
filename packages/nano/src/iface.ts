/**
 * Interfaces: a coordinate plus a set of ops, indexed by name and by op coord. A port is one op as offered by one
 * interface, written readably.
 *
 *   const db = Interface.define('acme/db', { get: Op.action('get', Key, Value) })
 *   port(db, db.ops.get)   // 'acme/db/get'
 */
import type { Static, TSchema } from 'typebox'
import type { InterfaceCoord } from './coord.ts'
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

function define<Ops extends Record<string, Op>>(at: string | InterfaceCoord, ops: Ops): Interface<Ops> {
  const coord = String(at)
  if (!COORD.test(coord)) throw new Error(`bad interface coordinate ${coord}`)
  for (const [key, o] of Object.entries(ops)) if (o.name !== key) throw new Error(`${coord}: op ${key} is named ${o.name}`)
  return { coord, ops, byCoord: new Map(Object.values(ops).map(o => [o.coord, o])) }
}

type Data<D> = NonNullable<D> extends { schema: infer S extends TSchema } ? Static<S> : never

/** Typed caller for an interface: each action is an async function. Events have none: they are published. */
export type Client<I extends Interface> = {
  [K in keyof I['ops'] as I['ops'][K]['kind'] extends 'event' ? never : K]: (input: Data<I['ops'][K]['input']>) => Promise<NanoResult<Data<I['ops'][K]['output']>>>
}

type Ops<I extends Interface> = I['ops']
type In<I extends Interface, K extends keyof Ops<I>> = Data<Ops<I>[K]['input']>
type Out<I extends Interface, K extends keyof Ops<I>> = Data<Ops<I>[K]['output']>

/** `Interface.define(coord, ops)`. */
export const Interface = { define }

export declare namespace Interface {
  /** The plain object an interface's actions describe: an input that is only `null` is no argument, an output that is
   *  only `null` is `void`. Events are not methods. */
  type Type<I extends Interface> = {
    [K in keyof Ops<I> as Ops<I>[K]['kind'] extends 'event' ? never : K]:
      (...args: [In<I, K>] extends [null] ? [] : [input: In<I, K>]) => Promise<[Out<I, K>] extends [null] ? void : Out<I, K>>
  }
}
