/**
 * Migration (spec behaviour 9). `v2` and `v3` each have a db with the same interface. A `migrate` pod is placed in
 * both and wired to each db, so a plain `one(DB)` is not-unique; it names the runtimes through its config
 * (`{ from: 'v2', to: 'v3' }`) and a selector's `runtime`, never in code.
 *
 *   v2:  migrate → db-v2 (rows a, b)      v3:  migrate → db-v3 (empty)
 */
import { describe, expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, Pod, success, type AppEvent, type Implementation } from '@pritzlaff/nano-core'
import { careless, db, migrate, migrationProvider } from './providers.ts'
import { observeCalls } from '../../packages/ui-workspace/src/observed-calls.ts'

/** v2 with rows a, b; v3 empty; `impl` placed in both as `migrate` and wired to each db. */
async function setup(impl: Implementation, config?: unknown) {
  const registry = Registry.create()
  registry.add(migrationProvider)
  const runtimes = AppDeployment.assemble({
    pods: { migrate: Pod.lazy(impl, { config }), 'db-v2': Pod.lazy(db, { config: ['a', 'b'] }), 'db-v3': Pod.lazy(db) },
    runtimes: {
      v2: { pods: ['migrate', 'db-v2'], subscriptions: [{ kind: 'call', from: 'migrate', to: 'db-v2' }] },
      v3: { pods: ['migrate', 'db-v3'], subscriptions: [{ kind: 'call', from: 'migrate', to: 'db-v3' }] },
    },
  }, registry)
  if (!runtimes.ok) throw new Error(runtimes.fail.reason)
  const r = await Application.create(runtimes.value, {})
  if (!r.ok) throw new Error(r.fail.reason)
  const events: AppEvent[] = [], observed = observeCalls(r.value, registry)
  r.value.listen(e => events.push(e))
  return { app: r.value, events, observed }
}
/** `from->to` of each message recorded in `runtime`. */
const sent = (events: AppEvent[], runtime: string) => events.flatMap(e => (e.type === 'sent' && e.runtime === runtime ? [`${e.from}->${e.to}`] : []))

describe('migration', () => {
  test('given migrate in v2 and v3 with config from v2 to v3, when run, then v3 has v2’s rows and each call is on its own runtime’s stream', async () => {
    const { app, events, observed } = await setup(migrate, { from: 'v2', to: 'v3' })
    expect(await app.call('v2', 'migrate').run({})).toEqual(success(2))
    expect(await app.call('v3', 'db-v3').all({})).toEqual(success(['a', 'b']))
    expect(sent(events, 'v2')).toEqual(['host->migrate', 'migrate->db-v2'])
    expect(sent(events, 'v3')).toEqual(['migrate->db-v3', 'host->db-v3'])
    // the db calls are caused by the run that made them, and declared
    const calls = events.flatMap(e => (e.type === 'sent' ? [e] : [])), run = calls[0]!
    expect(calls.filter(e => e.from === 'migrate').map(e => e.cause)).toEqual([run.id, run.id])
    const made = observed.calls().filter(c => c.seen && c.source !== null)
    expect(made.length).toBe(2)
    expect(made.filter(c => !c.declared)).toEqual([])
  })
  test('given a pod wired to a db in both runtimes, when it calls one(DB) without a runtime, then the call is not-unique', async () => {
    const { app } = await setup(careless)
    expect(await app.call('v2', 'migrate').run({})).toMatchObject({ ok: false, fail: { type: 'not-unique' } })
  })
})
