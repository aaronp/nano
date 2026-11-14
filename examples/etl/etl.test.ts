/**
 * ETL (spec: "The pod is the effect boundary", behaviour 10). One `etl` pod is registered in two runtimes: in `foo`
 * it is wired to a `source`, in `bar` to a `sink`. Its `run` reads and writes without naming either runtime; the
 * wiring decides, and each call is policed and recorded by the runtime that carries it.
 *
 *   foo:  etl → source      bar:  etl → sink
 */
import { describe, expect, test } from 'bun:test'
import { createRegistry, createRuntime, Pod, success, type Runtime, type RuntimeEvent } from '@pritzlaff/nano'
import { etl, etlProvider, sink, source, written } from './providers.ts'

const runtime = (id: string) => {
  const registry = createRegistry()
  registry.add(etlProvider)
  const rt = createRuntime(id, { registry })
  const events: RuntimeEvent[] = []
  rt.listen(e => events.push(e))
  return { rt, events }
}
const reg = (rt: Runtime, pod: Pod): string => { const r = rt.register(pod); if (!r.ok) throw new Error(r.fail.reason); return r.value }
const sentTo = (events: RuntimeEvent[]) => events.filter(e => e.type === 'sent').map(e => e.to)

describe('etl', () => {
  test('given etl wired to a source in foo and a sink in bar, when run through foo, then it reads in foo, writes in bar, and each call is on its own runtime’s stream only', async () => {
    const foo = runtime('foo'), bar = runtime('bar')
    const pipe = Pod.create(etl)
    const pf = reg(foo.rt, pipe), s = reg(foo.rt, Pod.create(source, { config: ['a', 'b'] }))
    const pb = reg(bar.rt, pipe), k = reg(bar.rt, Pod.create(sink))
    foo.rt.subscribe({ kind: 'call', from: pf, to: s })
    bar.rt.subscribe({ kind: 'call', from: pb, to: k })
    expect(await foo.rt.call(pf).run({})).toEqual(success(2))
    expect(written.rows).toEqual(['A', 'B'])
    expect(sentTo(foo.events)).toEqual([pf, s])
    expect(sentTo(bar.events)).toEqual([k])
    expect(pipe.runtimes).toEqual(['foo', 'bar'])
  })
  test('given etl with no sink wired anywhere, when run, then it fails missing-component and nothing is written', async () => {
    written.rows = []
    const foo = runtime('foo')
    const pf = reg(foo.rt, Pod.create(etl)), s = reg(foo.rt, Pod.create(source, { config: ['a'] }))
    foo.rt.subscribe({ kind: 'call', from: pf, to: s })
    expect(await foo.rt.call(pf).run({})).toMatchObject({ ok: false, fail: { type: 'missing-component' } })
    expect(written.rows).toEqual([])
  })
})
