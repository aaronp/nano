/**
 * The `example.migration` provider: an in-memory db, a migration that names its runtimes by config, and a careless one
 * that does not.
 *
 *   Pod.lazy(migrate, { config: { from: 'v2', to: 'v3' } })   // placed in both, wired to each db
 */
import { Coord, Implementation, provide, Selector, success } from '@pritzlaff/nano-core'
import { DB, Migrate } from './interfaces.ts'

const ns = Coord.namespace('example.migration')

export const db = Implementation.define(ns.implementationId('db'), { provides: [DB], make: (_ctx, seed: string[] = []) => {
  const rows = [...seed]
  return [provide(DB, { all: async () => success([...rows]), insert: async more => { rows.push(...more); return success(null) } })]
} })
/** Copies every row from `config.from` to `config.to`: the runtimes are named by config, chosen by the selector. */
export const migrate = Implementation.define(ns.implementationId('migrate'), {
  provides: [Migrate],
  dependencies: { db: DB },
  calls: { run: { db: [DB.ops.all, DB.ops.insert] } },
  make: (_ctx, config: { from: string; to: string }) => [provide(Migrate, { run: async (_, c) => {
    const from = c.one(Selector.of(DB, { runtime: config.from })), to = c.one(Selector.of(DB, { runtime: config.to }))
    if (!to.ok) return to
    if (!from.ok) return from
    const rows = await from.value.call.all({})
    if (!rows.ok) return rows
    const put = await to.value.call.insert(rows.value)
    return put.ok ? success(rows.value.length) : put
  } })],
})
/** The same, but asks for `one(DB)` without saying which runtime. */
export const careless = Implementation.define(ns.implementationId('careless'), {
  provides: [Migrate],
  dependencies: { db: DB },
  calls: { run: { db: [DB.ops.all] } },
  make: () => [provide(Migrate, { run: async (_, c) => {
    const db = c.one(DB)
    if (!db.ok) return db
    const rows = await db.value.call.all({})
    return rows.ok ? success(rows.value.length) : rows
  } })],
})

export const migrationProvider = ns.provider([db, migrate, careless])
