import { notAllowed, type Context, type InstanceRef } from '../types'

export type Predicate = (m:
  | { kind: 'emit'; event: string; payload: unknown }
  | { kind: 'call'; target: InstanceRef; action: string; input: unknown }) => boolean
export interface FilterContext extends Context { addPredicate(p: Predicate): void; removePredicate(p: Predicate): void }

export function filter(inner: Context, pred?: Predicate): FilterContext {
  const preds = new Set<Predicate>(pred ? [pred] : [])
  // A throwing predicate counts as false: never throw out of emit/call.
  const pass = (m: Parameters<Predicate>[0]) => [...preds].every(p => { try { return p(m) } catch { return false } })
  return {
    capabilities: () => inner.capabilities(),
    emit: (event, payload, scope) =>
      pass({ kind: 'emit', event: event.name, payload }) ? inner.emit(event, payload, scope) : Promise.resolve(notAllowed('filtered')),
    call: (target, action, input, scope) =>
      pass({ kind: 'call', target, action, input }) ? inner.call(target, action, input, scope) : Promise.resolve(notAllowed('filtered')),
    addPredicate: p => { preds.add(p) },
    removePredicate: p => { preds.delete(p) },
  }
}
