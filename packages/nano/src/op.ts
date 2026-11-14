/**
 * Ops: an action (input → output) or an event (data out, its `output`); the coordinate hashes its name and schemas.
 *
 *   const get = op.action('get', Key, Value)   // get.coord: same name + schemas, same coord
 *   fits(op.event('tick', Num), op.action('record', Num, Nothing))   // true
 */
import type { TSchema } from 'typebox'
import { canonical, hashOf, canonicalSchema, type SchemaDef } from './schema.ts'

export type OpKind = 'action' | 'event'

export type Op<I extends TSchema | undefined = TSchema | undefined, O extends TSchema | undefined = TSchema | undefined, K extends OpKind = OpKind> = {
  readonly name: string
  readonly kind: K
  readonly input?: SchemaDef<Exclude<I, undefined>>
  readonly output?: SchemaDef<Exclude<O, undefined>>
  readonly coord: string
  readonly description?: string
}

type Opts = { description?: string }

function make<K extends OpKind>(name: string, kind: K, input: SchemaDef | undefined, output: SchemaDef, o?: Opts): Op<any, any, K> {
  const coord = hashOf(canonical({ name, input: input?.hash ?? null, output: output.hash }))
  return { name, kind, ...(input && { input }), output, coord, ...(o?.description !== undefined && { description: o.description }) }
}

export const op = {
  action: <I extends TSchema, O extends TSchema>(name: string, input: SchemaDef<I>, output: SchemaDef<O>, o?: Opts): Op<I, O, 'action'> =>
    make(name, 'action', input, output, o),
  event: <O extends TSchema>(name: string, data: SchemaDef<O>, o?: Opts): Op<undefined, O, 'event'> => make(name, 'event', undefined, data, o),
}

/** The event's data is the action's input, or the action takes anything. */
export function fits(event: Op, action: Op): boolean {
  if (!event.output || !action.input) return false
  return event.output.hash === action.input.hash || canonicalSchema(action.input.schema) === '{}'
}
