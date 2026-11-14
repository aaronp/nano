/**
 * The ETL's contracts: read rows from a source, write them to a sink, and the pipeline that moves them.
 *
 *   ctx.one(Source)            // NanoResult<Client>: .read({}) gives string[]
 *   ctx.one(Sink)              // .write(['A']) gives the count written
 */
import { Type } from 'typebox'
import { defineSchema, iface, op } from '@pritzlaff/nano'

export const Rows = defineSchema('Rows', Type.Array(Type.String()))
export const Nothing = defineSchema('Nothing', Type.Object({}))
export const Count = defineSchema('Count', Type.Integer())

export const Source = iface('example.etl.Source', { read: op.action('read', Nothing, Rows) })
export const Sink = iface('example.etl.Sink', { write: op.action('write', Rows, Count) })
export const Pipeline = iface('example.etl.Pipeline', { run: op.action('run', Nothing, Count) })
