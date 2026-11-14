// @ts-nocheck — the effect-pod revision isn't built yet; remove when it lands
/**
 * ETL (spec: "The pod is the effect boundary", behaviour 10). One `etl` pod is registered in two runtimes: in `foo`
 * it is wired to a `source`, in `bar` to a `sink`. Its `run` reads and writes without naming either runtime; the
 * wiring decides, and each call is policed and recorded by the runtime that carries it.
 *
 *   foo:  etl → source      bar:  etl → sink
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

const Source = iface('example.etl.Source', { read: op.action('read', Nothing, Rows) })
const Sink = iface('example.etl.Sink', { write: op.action('write', Rows, Count) })
const Pipeline = iface('example.etl.Pipeline', { run: op.action('run', Nothing, Count) })

const source = implementation('example.etl/source', { provides: [Source], make: (rows: string[] = []) => [provide(Source, { read: async () => success(rows) })] })
let written: string[] = []
const sink = implementation('example.etl/sink', { provides: [Sink], make: () => [provide(Sink, { write: async (_c, rows) => { written = rows; return success(rows.length) } })] })
/** Reads, transforms (upper-cases), writes. Never names a runtime. */
const etl = implementation('example.etl/etl', {
  provides: [Pipeline],
  dependencies: { from: Source, to: Sink },
  make: () => [provide(Pipeline, { run: async ctx => {
    const rows = await ctx.one(Source, s => s.read({}))
    return rows.ok ? ctx.one(Sink, s => s.write(rows.value.map(r => r.toUpperCase()))) : rows
  } })],
})

const runtime = (id: string) => {
  const registry = createRegistry()
  registry.add(provider('example.etl', [source, sink, etl]))
  const rt = createRuntime(id, { registry })
  const events: RuntimeEvent[] = []
  rt.listen(e => events.push(e))
  return { rt, events }
}
const reg = (rt, pod): string => { const r = rt.register(pod); if (!r.ok) throw new Error(r.fail.reason); return r.value }
const sentTo = (events: RuntimeEvent[]) => events.filter(e => e.type === 'sent').map(e => e.to)

describe('etl', () => {
  test.todo('given etl wired to a source in foo and a sink in bar, when run through foo, then it reads in foo, writes in bar, and each call is on its own runtime’s stream only', async () => {
    const foo = runtime('foo'), bar = runtime('bar')
    const pipe = Pod.create(etl)
    const pf = reg(foo.rt, pipe), s = reg(foo.rt, Pod.create(source, { config: ['a', 'b'] }))
    const pb = reg(bar.rt, pipe), k = reg(bar.rt, Pod.create(sink))
    foo.rt.subscribe({ kind: 'call', from: pf, to: s })
    bar.rt.subscribe({ kind: 'call', from: pb, to: k })
    expect(await foo.rt.call(pf).run({})).toEqual(success(2))
    expect(written).toEqual(['A', 'B'])
    expect(sentTo(foo.events)).toEqual([pf, s])
    expect(sentTo(bar.events)).toEqual([k])
    expect(pipe.runtimes).toEqual(['foo', 'bar'])
  })
  test.todo('given etl with no sink wired anywhere, when run, then it fails missing-component and nothing is written', async () => {
    written = []
    const foo = runtime('foo')
    const pf = reg(foo.rt, Pod.create(etl)), s = reg(foo.rt, Pod.create(source, { config: ['a'] }))
    foo.rt.subscribe({ kind: 'call', from: pf, to: s })
    expect(await foo.rt.call(pf).run({})).toMatchObject({ ok: false, fail: { type: 'missing-component' } })
    expect(written).toEqual([])
  })
})
