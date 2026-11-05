import type { Context, Result } from '../types'

export type TraceEntry = { kind: 'emit' | 'call'; at: number; args: unknown[]; result: Result<unknown> }

export function trace(inner: Context, sink: (e: TraceEntry) => void): Context {
  const rec = (e: TraceEntry) => { try { sink(e) } catch { /* sink must not break emit/call */ } }
  return {
    capabilities: () => inner.capabilities(),
    async emit(event, payload, scope) {
      const result = await inner.emit(event, payload, scope)
      rec({ kind: 'emit', at: Date.now(), args: [event, payload], result })
      return result
    },
    async call(target, action, input, scope) {
      const result = await inner.call(target, action, input, scope)
      rec({ kind: 'call', at: Date.now(), args: [target, action, input], result })
      return result
    },
  }
}
