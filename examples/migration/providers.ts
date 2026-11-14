/**
 * The `example.migration` provider: an in-memory db, a migration that names its runtimes by config, and a careless one
 * that does not.
 *
 *   Pod.create(migrate, { config: { from: 'v2', to: 'v3' } })   // registered in both, wired to each db
 */
import { implementation, provide, provider, sel, success } from '@pritzlaff/nano'
import { DB, Migrate } from './interfaces.ts'

export const db = implementation('example.migration/db', { provides: [DB], make: (seed: string[] = []) => {
  const rows = [...seed]
  return [provide(DB, { all: async () => success([...rows]), insert: async (_c, more) => { rows.push(...more); return success(null) } })]
} })
/** Copies every row from `config.from` to `config.to`: the runtimes are named by config, chosen by the selector. */
export const migrate = implementation('example.migration/migrate', {
  provides: [Migrate],
  dependencies: { db: DB },
  make: (config: { from: string; to: string }) => [provide(Migrate, { run: async ctx => {
    const rows = await ctx.one(sel(DB, { runtime: config.from }), d => d.all({}))
    if (!rows.ok) return rows
    const put = await ctx.one(sel(DB, { runtime: config.to }), d => d.insert(rows.value))
    return put.ok ? success(rows.value.length) : put
  } })],
})
/** The same, but asks for `one(DB)` without saying which runtime. */
export const careless = implementation('example.migration/careless', {
  provides: [Migrate],
  dependencies: { db: DB },
  make: () => [provide(Migrate, { run: async ctx => {
    const rows = await ctx.one(DB, d => d.all({}))
    return rows.ok ? success(rows.value.length) : rows
  } })],
})

export const migrationProvider = provider('example.migration', [db, migrate, careless])
