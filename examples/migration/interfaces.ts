/**
 * The migration's contracts: a database of rows, and the migration that copies one to another.
 *
 *   ctx.one(sel(DB, { runtime: 'v2' }))   // NanoResult<Client>: .all({}) gives the rows in v2's db
 */
import { Type } from 'typebox'
import { defineSchema, iface, op } from '@pritzlaff/nano'

export const Rows = defineSchema('Rows', Type.Array(Type.String()))
export const Nothing = defineSchema('Nothing', Type.Object({}))
export const Count = defineSchema('Count', Type.Integer())
export const Done = defineSchema('Done', Type.Null())

export const DB = iface('example.migration.DB', { all: op.action('all', Nothing, Rows), insert: op.action('insert', Rows, Done) })
export const Migrate = iface('example.migration.Migrate', { run: op.action('run', Nothing, Count) })
