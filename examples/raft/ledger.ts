/**
 * `example.raft/ledger`: a node's stable storage, in memory. `write` replaces what it holds and publishes it as
 * `written`, so its state at any time can be folded from the history (`ledgerStep`, fold.ts).
 */
import { Coord, Implementation, provide, success } from '@pritzlaff/nano-core'
import { Ledger } from './interfaces.ts'
import type { Persistent } from './core/types.ts'

const ns = Coord.namespace('example.raft')

export const EMPTY: Persistent = { currentTerm: 0, votedFor: null, log: [] }

export const ledger = Implementation.define(ns.implementationId('ledger'), {
  provides: [Ledger],
  make: ctx => {
    let held = EMPTY
    return [provide(Ledger, {
      read: async () => success(held),
      write: async p => { held = p; await ctx.publish(Ledger.ops.written, p); return success(null) },
    })]
  },
})
