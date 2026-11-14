/**
 * Migration (spec: "The pod is the effect boundary", behaviour 11). `v2` and `v3` each have a `db` with the same
 * interface. A `migrate` pod is registered in both and wired to each `db`, so a plain `one(DB)` is ambiguous; it
 * names the runtimes through its config (`{ from: 'v2', to: 'v3' }`) and a selector's `runtime`, never in code.
 *
 *   v2:  migrate → db (rows a, b)      v3:  migrate → db (empty)
 */
import { describe, expect, test } from 'bun:test'
import { createRegistry, createRuntime, Pod, success, type Implementation, type Runtime, type RuntimeEvent } from '@pritzlaff/nano'
import { careless, db, migrate, migrationProvider } from './providers.ts'

const runtime = (id: string) => {
  const registry = createRegistry()
  registry.add(migrationProvider)
  const rt = createRuntime(id, { registry })
  const events: RuntimeEvent[] = []
  rt.listen(e => events.push(e))
  return { rt, events }
}
const reg = (rt: Runtime, pod: Pod): string => { const r = rt.register(pod); if (!r.ok) throw new Error(r.fail.reason); return r.value }
const sentTo = (events: RuntimeEvent[]) => events.filter(e => e.type === 'sent').map(e => e.to)
/** v2 with rows a, b; v3 empty; `impl` registered in both and wired to each db. */
const setup = (impl: Implementation, config?: unknown) => {
  const v2 = runtime('v2'), v3 = runtime('v3')
  const pod = Pod.create(impl, { config })
  const m2 = reg(v2.rt, pod), d2 = reg(v2.rt, Pod.create(db, { config: ['a', 'b'] }))
  const m3 = reg(v3.rt, pod), d3 = reg(v3.rt, Pod.create(db))
  v2.rt.subscribe({ kind: 'call', from: m2, to: d2 })
  v3.rt.subscribe({ kind: 'call', from: m3, to: d3 })
  return { v2, v3, m2, d2, d3 }
}

describe('migration', () => {
  test('given migrate in v2 and v3 with config from v2 to v3, when run, then v3 has v2’s rows and each call is on its own runtime’s stream', async () => {
    const { v2, v3, m2, d2, d3 } = setup(migrate, { from: 'v2', to: 'v3' })
    expect(await v2.rt.call(m2).run({})).toEqual(success(2))
    expect(await v3.rt.call(d3).all({})).toEqual(success(['a', 'b']))
    expect(sentTo(v2.events)).toEqual([m2, d2])
    expect(sentTo(v3.events)).toEqual([d3, d3])
  })
  test('given a pod wired to a db in both runtimes, when it calls one(DB) without a runtime, then the call is ambiguous', async () => {
    const { v2, m2 } = setup(careless)
    expect(await v2.rt.call(m2).run({})).toMatchObject({ ok: false, fail: { type: 'ambiguous' } })
  })
})
