/**
 * The `example.migration` provider: an in-memory db, a migration that names its runtimes by config, and a careless one
 * that does not.
 *
 *   Pod.lazy(migrate, { config: { from: 'v2', to: 'v3' } })   // placed in both, wired to each db
 */
import { implementation, provide, provider, sel, success } from '@pritzlaff/nano'
import { DB, Migrate } from './interfaces.ts'

export const db = implementation('example.migration/db', { provides: [DB], make: (_ctx, seed: string[] = []) => {
  const rows = [...seed]
  return [provide(DB, { all: async () => success([...rows]), insert: async more => { rows.push(...more); return success(null) } })]
} })
/** Copies every row from `config.from` to `config.to`: the runtimes are named by config, chosen by the selector. */
export const migrate = implementation('example.migration/migrate', {
  provides: [Migrate],
  dependencies: { db: DB },
  make: (ctx, config: { from: string; to: string }) => [provide(Migrate, { run: async () => {
    const from = ctx.one(sel(DB, { runtime: config.from })), to = ctx.one(sel(DB, { runtime: config.to }))
    if (!to.ok) return { ok: false, fail: to.fail! }
    const rows = await from.call.all({})
    if (!rows.ok) return rows
    const put = await to.call.insert(rows.value)
    return put.ok ? success(rows.value.length) : put
  } })],
})
/** The same, but asks for `one(DB)` without saying which runtime. */
export const careless = implementation('example.migration/careless', {
  provides: [Migrate],
  dependencies: { db: DB },
  make: ctx => [provide(Migrate, { run: async () => {
    const rows = await ctx.one(DB).call.all({})
    return rows.ok ? success(rows.value.length) : rows
  } })],
})

export const migrationProvider = provider('example.migration', [db, migrate, careless])
