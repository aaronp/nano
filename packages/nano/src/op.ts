/**
 * Ops: an action (input → output) or an event (data out, its `output`). An op is a signature, unnamed: the interface
 * names it by key, and its coordinate (hash of name and schemas) is computed there.
 *
 *   const api = Interface.define('acme/db', { get: Op.action(Key, Value) })   // api.ops.get.name: 'get'
 *   fits(Op.event(Num), Op.action(Num, Nothing))   // true
 */
import type { TSchema } from 'typebox'
import { canonicalSchema, Schema, type SchemaDef } from './schema.ts'

export type OpKind = 'action' | 'event'

/** An op as an interface holds it: named by its key, with its coordinate. */
export type Op<I extends TSchema | undefined = TSchema | undefined, O extends TSchema | undefined = TSchema | undefined, K extends OpKind = OpKind> = {
  readonly name: string
  readonly kind: K
  readonly input?: SchemaDef<Exclude<I, undefined>>
  readonly output?: SchemaDef<Exclude<O, undefined>>
  readonly coord: string
  readonly description?: string
}

type Opts = { description?: string }
/** A `SchemaDef`, or a bare TypeBox schema (defined here, unlabelled). */
type Given = SchemaDef | TSchema
type Of<G> = G extends { readonly schema: infer S extends TSchema; readonly hash: string } ? S : G extends TSchema ? G : never
const def = (g: Given): SchemaDef => ('hash' in g && 'check' in g ? g as SchemaDef : Schema.define(g))
type Unnamed<I extends TSchema | undefined, O extends TSchema | undefined, K extends OpKind> = Omit<Op<I, O, K>, 'name' | 'coord'>

function make<K extends OpKind>(kind: K, given: Given | undefined, out: Given, o?: Opts): Unnamed<any, any, K> {
  const input = given && def(given)
  return { kind, ...(input && { input }), output: def(out), ...(o?.description !== undefined && { description: o.description }) }
}

export const Op = {
  action: <I extends Given, O extends Given>(input: I, output: O, o?: Opts): Unnamed<Of<I>, Of<O>, 'action'> => make('action', input, output, o),
  event: <O extends Given>(data: O, o?: Opts): Unnamed<undefined, Of<O>, 'event'> => make('event', undefined, data, o),
}

/** The source's data (an event's, or an action's result) is the target action's input, or the action takes anything. */
export function fits(source: Pick<Op, 'output'>, action: Pick<Op, 'input'>): boolean {
  if (!source.output || !action.input) return false
  return source.output.hash === action.input.hash || canonicalSchema(action.input.schema) === '{}'
}
