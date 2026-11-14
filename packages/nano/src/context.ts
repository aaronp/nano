/**
 * The context a pod's factory gets. It belongs to the pod, not to a call: `one` and `all` read the deployment as it is
 * now, over the call subscriptions from `self` in every runtime the pod is placed in, each a `Selection`.
 *
 *   const kv = ctx.one(KeyValueStore)            // Selection: not ok (not-found, ambiguous) unless exactly one is wired
 *   await kv.call.put('k')                       // through that edge; on a failed selection, its Fail
 *   kv.on(KeyValueStore.ops.changed, d => …)     // hear that pod's event (or an action's results) while this build lives
 *   if (ctx.all(KeyValueStore).length === 0) …   // nothing wired: fall back
 *   await ctx.publish(Ticks.ops.tick, 1)         // along every pipe from self with that source, and to `on` subscribers
 *   ctx.addOnCloseListener(() => clearInterval(timer))   // when this build is closed: restarted, removed, changed or closed
 */
import type { Client, Interface } from './iface.ts'
import type { Op } from './op.ts'
import type { Fail } from './result.ts'
import type { SelectorData } from './selector.ts'

/** One call edge from the pod, or why there is not exactly one. Nothing on it throws. */
export type Selection<I extends Interface> = {
  readonly ok: boolean
  readonly fail?: Fail
  readonly pod?: string
  readonly runtime?: string
  readonly call: Client<I>
  on(op: Op, fn: (data: unknown) => void | Promise<void>): () => void
}

export type NanoContext = {
  readonly self: string
  readonly runtimes: readonly string[]
  one<I extends Interface>(s: I | SelectorData): Selection<I>
  all<I extends Interface>(s: I | SelectorData): Selection<I>[]
  publish(o: Op, data: unknown): Promise<void>
  addOnCloseListener(fn: (e: { reason: 'restarted' | 'removed' | 'changed' | 'closed' }) => void | Promise<void>): void
}
