/**
 * The `example.etl` provider: a source holding rows, a sink that keeps what it is given, and the pipeline between them.
 *
 *   registry.add(etlProvider)
 *   Pod.lazy(etl)   // reads from whichever source a runtime wires it to, writes to whichever sink
 */
import { implementation, provide, provider, success } from '@pritzlaff/nano'
import { Pipeline, Sink, Source } from './interfaces.ts'

/** The rows last written to any sink, for a test to read. */
export const written = { rows: [] as string[] }

export const source = implementation('example.etl/source', { provides: [Source], make: (_ctx, rows: string[] = []) => [provide(Source, { read: async () => success(rows) })] })
export const sink = implementation('example.etl/sink', { provides: [Sink], make: () => [provide(Sink, { write: async rows => { written.rows = rows; return success(rows.length) } })] })
/** Reads, transforms (upper-cases), writes. Never names a runtime. */
export const etl = implementation('example.etl/etl', {
  provides: [Pipeline],
  dependencies: { from: Source, to: Sink },
  make: ctx => [provide(Pipeline, { run: async () => {
    const from = ctx.one(Source), to = ctx.one(Sink)
    if (!to.ok) return { ok: false, fail: to.fail! }
    const rows = await from.call.read({})
    return rows.ok ? to.call.write(rows.value.map(r => r.toUpperCase())) : rows
  } })],
})

export const etlProvider = provider('example.etl', [source, sink, etl])
