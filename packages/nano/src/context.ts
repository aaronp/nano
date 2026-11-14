/**
 * The context a pod's factory gets. It belongs to the pod, not to a call: `one` and `all` read the deployment as it is
 * now, over the call subscriptions from `self` in every runtime the pod is placed in.
 *
 *   const kv = ctx.one(KeyValueStore)            // NanoResult<Client>: not-found when none, ambiguous when several
 *   if (ctx.all(KeyValueStore).length === 0) …   // nothing wired: fall back
 *   await ctx.publish(Ticks.ops.tick, 1)         // to every event subscription from self with that source
 */
import type { Client, Interface } from './iface.ts'
import type { Op } from './op.ts'
import type { NanoResult } from './result.ts'
import type { SelectorData } from './selector.ts'

export type NanoContext = {
  readonly self: string
  readonly runtimes: readonly string[]
  one<I extends Interface>(s: I | SelectorData): NanoResult<Client<I>>
  all<I extends Interface>(s: I | SelectorData): Client<I>[]
  publish(o: Op, data: unknown): Promise<void>
}
