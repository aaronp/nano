/**
 * The migration's contracts: a database of rows, and the migration that copies one to another.
 *
 *   ctx.one(Selector.of(DB, { runtime: 'v2' }))   // Selection: .call.all({}) gives the rows in v2's db
 */
import { Type } from 'typebox'
import { Schema, Interface, Op } from '@pritzlaff/nano-core'

export const Rows = Schema.define('Rows', Type.Array(Type.String()))
export const Nothing = Schema.define('Nothing', Type.Object({}))
export const Count = Schema.define('Count', Type.Integer())
export const Done = Schema.define('Done', Type.Null())

export const DB = Interface.define('example.migration.DB', { all: Op.action('all', Nothing, Rows), insert: Op.action('insert', Rows, Done) })
export const Migrate = Interface.define('example.migration.Migrate', { run: Op.action('run', Nothing, Count) })
