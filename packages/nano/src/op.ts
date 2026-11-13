/**
 * Ops: a named operation whose coordinate is the hash of its name and schemas.
 *
 *   const get = op.action('get', Key, Value)   // get.coord: same name + schemas, same coord
 *   fits(op.source('tick', Num), op.sink('log', Num))   // true
 */
import type { TSchema } from 'typebox'
import { canonical, hashOf, canonicalSchema, type SchemaDef } from './schema.ts'

export type OpKind = 'action' | 'source' | 'sink'

export type Op<I extends TSchema | undefined = TSchema | undefined, O extends TSchema | undefined = TSchema | undefined, K extends OpKind = OpKind> = {
  readonly name: string
  readonly kind: K
  readonly input?: SchemaDef<Exclude<I, undefined>>
  readonly output?: SchemaDef<Exclude<O, undefined>>
  readonly coord: string
  readonly description?: string
}

type Opts = { description?: string }

function make<K extends OpKind>(name: string, kind: K, input: SchemaDef | undefined, output: SchemaDef | undefined, o?: Opts): Op<any, any, K> {
  const coord = hashOf(canonical({ name, input: input?.hash ?? null, output: output?.hash ?? null }))
  return { name, kind, ...(input && { input }), ...(output && { output }), coord, ...(o?.description !== undefined && { description: o.description }) }
}

export const op = {
  action: <I extends TSchema, O extends TSchema>(name: string, input: SchemaDef<I>, output: SchemaDef<O>, o?: Opts): Op<I, O, 'action'> =>
    make(name, 'action', input, output, o),
  source: <O extends TSchema>(name: string, output: SchemaDef<O>, o?: Opts): Op<undefined, O, 'source'> => make(name, 'source', undefined, output, o),
  sink: <I extends TSchema>(name: string, input: SchemaDef<I>, o?: Opts): Op<I, undefined, 'sink'> => make(name, 'sink', input, undefined, o),
}

/** The source's output is the target's input, or the target takes anything. */
export function fits(source: Op, target: Op): boolean {
  if (!source.output || !target.input) return false
  return source.output.hash === target.input.hash || canonicalSchema(target.input.schema) === '{}'
}
