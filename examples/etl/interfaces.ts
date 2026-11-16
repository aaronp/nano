/**
 * The ETL's contracts: read rows from a source, write them to a sink, and the pipeline that moves them.
 *
 *   ctx.one(Source)            // Selection: .call.read({}) gives string[]
 *   ctx.one(Sink)              // .call.write(['A']) gives the count written
 */
import { Type } from 'typebox'
import { Schema, Interface, Op } from '@pritzlaff/nano-core'

export const Rows = Schema.define('Rows', Type.Array(Type.String()))
export const Nothing = Schema.define('Nothing', Type.Object({}))
export const Count = Schema.define('Count', Type.Integer())

export const Source = Interface.define('example.etl.Source', { read: Op.action('read', Nothing, Rows) })
export const Sink = Interface.define('example.etl.Sink', { write: Op.action('write', Rows, Count) })
export const Pipeline = Interface.define('example.etl.Pipeline', { run: Op.action('run', Nothing, Count) })
