/**
 * The ETL's contracts: read rows from a source, write them to a sink, and the pipeline that moves them.
 *
 *   ctx.one(Source)            // success(Selection): .value.call.read({}) gives string[]
 *   ctx.one(Sink)              // .value.call.write(['A']) gives the count written
 */
import { Type } from 'typebox'
import { Coord, Schema, Op } from '@pritzlaff/nano-core'

const ns = Coord.namespace('example.etl')

export const Rows = Schema.define(Type.Array(Type.String()), 'Rows')
export const Nothing = Schema.define(Type.Object({}), 'Nothing')
export const Count = Schema.define(Type.Integer(), 'Count')

export const Source = ns.interface('Source', { read: Op.action(Nothing, Rows) })
export const Sink = ns.interface('Sink', { write: Op.action(Rows, Count) })
export const Pipeline = ns.interface('Pipeline', { run: Op.action(Nothing, Count) })
