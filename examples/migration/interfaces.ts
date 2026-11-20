/**
 * The migration's contracts: a database of rows, and the migration that copies one to another.
 *
 *   ctx.one(Selector.of(DB, { runtime: Coord.runtime('v2') }))   // success(Selection): .value.call.all({}) gives the rows in v2's db
 */
import { Type } from 'typebox'
import { Coord, Schema, Op } from '@pritzlaff/nano-core'

const ns = Coord.namespace('example.migration')

export const Rows = Schema.define(Type.Array(Type.String()), 'Rows')
export const Nothing = Schema.define(Type.Object({}), 'Nothing')
export const Count = Schema.define(Type.Integer(), 'Count')
export const Done = Schema.define(Type.Null(), 'Done')

export const DB = ns.interface('DB', { all: Op.action(Nothing, Rows), insert: Op.action(Rows, Done) })
export const Migrate = ns.interface('Migrate', { run: Op.action(Nothing, Count) })
