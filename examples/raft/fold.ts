/**
 * A ledger's contents at any time, folded from the recorded history (no re-running): the last successful `write` to
 * it (each write holds the whole state, and `written` publishes the same value, so the calls say it all: an event is
 * recorded only while someone listens). `undefined` while no deployment places the pod; empty when one does, until
 * its first write. It assumes what it can't see does nothing: a nano `restart` of the pod, or a change of its
 * implementation or config in place (a cluster is deployed once, by name, and removed whole).
 *
 *   await foldAt(store, t, ledgerStep('example-1-ledger'))   // what Ledger.read gave at t
 */
import { port } from '@pritzlaff/nano-core'
import type { foldAt } from '@pritzlaff/nano-ui'
import type { Persistent } from './core/types.ts'
import { Ledger } from './interfaces.ts'
import { EMPTY } from './ledger.ts'

const WRITE = port(Ledger, Ledger.ops.write)

/** The reducer for `foldAt` over the ledger pod `pod`. */
export function ledgerStep(pod: string): Parameters<typeof foldAt<Persistent | undefined>>[2] {
  return {
    initial: undefined,
    step: (s, m) => m.sent.to === pod && m.sent.port === WRITE && m.outcome?.type === 'delivered' && m.outcome.ok && m.sent.input !== undefined
      ? JSON.parse(m.sent.input) : s,
    deployment: (s, d) => (d.pods[pod] ? s ?? EMPTY : undefined),
  }
}
