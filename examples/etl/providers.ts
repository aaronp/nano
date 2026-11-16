/**
 * The `example.etl` provider: a source holding rows, a sink that keeps what it is given, and the pipeline between them.
 *
 *   registry.add(etlProvider)
 *   Pod.lazy(etl)   // reads from whichever source a runtime wires it to, writes to whichever sink
 */
import { Coord, Implementation, provide, success } from '@pritzlaff/nano-core'
import { Pipeline, Sink, Source } from './interfaces.ts'

const ns = Coord.namespace('example.etl')

/** The rows last written to any sink, for a test to read. */
export const written = { rows: [] as string[] }

export const source = Implementation.define(ns.implementationId('source'), { provides: [Source], make: (_ctx, rows: string[] = []) => [provide(Source, { read: async () => success(rows) })] })
export const sink = Implementation.define(ns.implementationId('sink'), { provides: [Sink], make: () => [provide(Sink, { write: async rows => { written.rows = rows; return success(rows.length) } })] })
/** Reads, transforms (upper-cases), writes. Never names a runtime. */
export const etl = Implementation.define(ns.implementationId('etl'), {
  provides: [Pipeline],
  dependencies: { from: Source, to: Sink },
  make: ctx => [provide(Pipeline, { run: async () => {
    const from = ctx.one(Source), to = ctx.one(Sink)
    if (!to.ok) return to
    if (!from.ok) return from
    const rows = await from.value.call.read({})
    return rows.ok ? to.value.call.write(rows.value.map(r => r.toUpperCase())) : rows
  } })],
})

export const etlProvider = ns.provider([source, sink, etl])
