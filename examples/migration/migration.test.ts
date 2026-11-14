// @ts-nocheck — the effect-pod revision isn't built yet; remove when it lands
/**
 * Migration (spec: "The pod is the effect boundary", behaviour 11). `v2` and `v3` each have a `db` with the same
 * interface. A `migrate` pod is registered in both and wired to each `db`, so a plain `one(DB)` is ambiguous; it
 * names the runtimes through its config (`{ from: 'v2', to: 'v3' }`) and a selector's `runtime`, never in code.
 *
 *   v2:  migrate → db (rows a, b)      v3:  migrate → db (empty)
 *
 * The interfaces and implementations live here while the revision is todo; they move to interfaces.ts and
 * providers.ts when it lands.
 */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import * as nano from '@pritzlaff/nano'
import { createRegistry, createRuntime, defineSchema, iface, implementation, op, provide, provider, success, type RuntimeEvent } from '@pritzlaff/nano'

const { Pod } = nano as unknown as { Pod: { create(i: unknown, opts?: { config?: unknown }): any } }

const Rows = defineSchema('Rows', Type.Array(Type.String()))
const Nothing = defineSchema('Nothing', Type.Object({}))
const Count = defineSchema('Count', Type.Integer())
const Done = defineSchema('Done', Type.Null())

const DB = iface('example.migration.DB', { all: op.action('all', Nothing, Rows), insert: op.action('insert', Rows, Done) })
const Migrate = iface('example.migration.Migrate', { run: op.action('run', Nothing, Count) })

const db = implementation('example.migration/db', { provides: [DB], make: (seed: string[] = []) => {
  const rows = [...seed]
  return [provide(DB, { all: async () => success([...rows]), insert: async (_c, more) => { rows.push(...more); return success(null) } })]
} })
/** Copies every row from `config.from` to `config.to`: the runtimes are named by config, chosen by the selector. */
const migrate = implementation('example.migration/migrate', {
  provides: [Migrate],
  dependencies: { db: DB },
  make: (config: { from: string; to: string }) => [provide(Migrate, { run: async ctx => {
    const rows = await ctx.one({ implements: DB.coord, runtime: config.from }, d => d.all({}))
    if (!rows.ok) return rows
    const put = await ctx.one({ implements: DB.coord, runtime: config.to }, d => d.insert(rows.value))
    return put.ok ? success(rows.value.length) : put
  } })],
})
/** The same, but asks for `one(DB)` without saying which runtime. */
const careless = implementation('example.migration/careless', {
  provides: [Migrate],
  dependencies: { db: DB },
  make: () => [provide(Migrate, { run: async ctx => ctx.one(DB, d => d.all({})) })],
})

const runtime = (id: string) => {
  const registry = createRegistry()
  registry.add(provider('example.migration', [db, migrate, careless]))
  const rt = createRuntime(id, { registry })
  const events: RuntimeEvent[] = []
  rt.listen(e => events.push(e))
  return { rt, events }
}
const reg = (rt, pod): string => { const r = rt.register(pod); if (!r.ok) throw new Error(r.fail.reason); return r.value }
const sentTo = (events: RuntimeEvent[]) => events.filter(e => e.type === 'sent').map(e => e.to)
/** v2 with rows a, b; v3 empty; `impl` registered in both and wired to each db. */
const setup = (impl, config?) => {
  const v2 = runtime('v2'), v3 = runtime('v3')
  const pod = Pod.create(impl, { config })
  const m2 = reg(v2.rt, pod), d2 = reg(v2.rt, Pod.create(db, { config: ['a', 'b'] }))
  const m3 = reg(v3.rt, pod), d3 = reg(v3.rt, Pod.create(db))
  v2.rt.subscribe({ kind: 'call', from: m2, to: d2 })
  v3.rt.subscribe({ kind: 'call', from: m3, to: d3 })
  return { v2, v3, m2, d2, d3 }
}

describe('migration', () => {
  test.todo('given migrate in v2 and v3 with config from v2 to v3, when run, then v3 has v2’s rows and each call is on its own runtime’s stream', async () => {
    const { v2, v3, m2, d2, d3 } = setup(migrate, { from: 'v2', to: 'v3' })
    expect(await v2.rt.call(m2).run({})).toEqual(success(2))
    expect(await v3.rt.call(d3).all({})).toEqual(success(['a', 'b']))
    expect(sentTo(v2.events)).toEqual([m2, d2])
    expect(sentTo(v3.events)).toEqual([d3, d3])
  })
  test.todo('given a pod wired to a db in both runtimes, when it calls one(DB) without a runtime, then the call is ambiguous', async () => {
    const { v2, m2 } = setup(careless)
    expect(await v2.rt.call(m2).run({})).toMatchObject({ ok: false, fail: { type: 'ambiguous' } })
  })
})
