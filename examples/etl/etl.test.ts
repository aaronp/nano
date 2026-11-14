/**
 * ETL (spec behaviour 8). One `etl` pod is placed in two runtimes: in `foo` it is wired to a `source`, in `bar` to a
 * `sink`. Its `run` reads and writes without naming either runtime; the wiring decides, and each call is policed and
 * recorded by the runtime that carries it.
 *
 *   foo:  etl → source      bar:  etl → sink
 */
import { describe, expect, test } from 'bun:test'
import { Application, createRegistry, Pod, success, type AppEvent, type AppDeployment } from '@pritzlaff/nano'
import { etl, etlProvider, sink, source, written } from './providers.ts'

async function live(d: AppDeployment) {
  const registry = createRegistry()
  registry.add(etlProvider)
  const r = await Application.create(d, { registry })
  if (!r.ok) throw new Error(r.fail.reason)
  const events: AppEvent[] = []
  r.value.listen(e => events.push(e))
  return { app: r.value, events }
}
/** `from->to` of each message recorded in `runtime`. */
const sent = (events: AppEvent[], runtime: string) => events.flatMap(e => (e.type === 'sent' && e.runtime === runtime ? [`${e.from}->${e.to}`] : []))
const placedIn = (d: AppDeployment, pod: string) => Object.entries(d.runtimes).flatMap(([id, r]) => (r.pods.includes(pod) ? [id] : []))

describe('etl', () => {
  test('given etl wired to a source in foo and a sink in bar, when run through foo, then it reads in foo, writes in bar, and each call is on its own runtime’s stream only', async () => {
    const { app, events } = await live({
      pods: { etl: Pod.lazy(etl), source: Pod.lazy(source, { config: ['a', 'b'] }), sink: Pod.lazy(sink) },
      runtimes: {
        foo: { pods: ['etl', 'source'], subscriptions: [{ kind: 'call', from: 'etl', to: 'source' }] },
        bar: { pods: ['etl', 'sink'], subscriptions: [{ kind: 'call', from: 'etl', to: 'sink' }] },
      },
    })
    expect(await app.call('foo', 'etl').run({})).toEqual(success(2))
    expect(written.rows).toEqual(['A', 'B'])
    expect(sent(events, 'foo')).toEqual(['host->etl', 'etl->source'])
    expect(sent(events, 'bar')).toEqual(['etl->sink'])
    expect(placedIn(app.deployment(), 'etl')).toEqual(['foo', 'bar'])
  })
  test('given etl with no sink wired anywhere, when run, then it fails not-found and nothing is written', async () => {
    written.rows = []
    const { app } = await live({
      pods: { etl: Pod.lazy(etl), source: Pod.lazy(source, { config: ['a'] }) },
      runtimes: { foo: { pods: ['etl', 'source'], subscriptions: [{ kind: 'call', from: 'etl', to: 'source' }] } },
    })
    expect(await app.call('foo', 'etl').run({})).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(written.rows).toEqual([])
  })
})
