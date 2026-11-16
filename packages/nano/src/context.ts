/**
 * The context a pod's factory gets. It belongs to the pod, not to a call: `one` and `all` read the deployment as it is
 * now, over the call subscriptions from `self` in every runtime the pod is placed in, each a `Selection`.
 *
 *   const kv = ctx.one(KeyValueStore)            // NanoResult<Selection>: a Fail (not-found, ambiguous) unless exactly one is wired
 *   if (kv.ok) await kv.value.call.put('k')      // through that edge
 *   if (kv.ok) kv.value.on(KeyValueStore.ops.changed, d => …)   // hear that pod's event (typed by the op) while this build lives
 *   await ctx.deps.store.put('k')                // a declared role as a plain object: through ctx.one(role) at each call; a Fail throws
 *   if (ctx.all(KeyValueStore).length === 0) …   // nothing wired: fall back
 *   await ctx.publish(Ticks.ops.tick, 1)         // along every pipe from self with that source, and to `on` subscribers
 *   ctx.addOnCloseListener(() => clearInterval(timer))   // when this build is closed: restarted, removed, changed or closed
 */
import type { Static, TSchema } from 'typebox'
import type { Client, Interface } from './iface.ts'
import type { Op } from './op.ts'
import type { NanoResult } from './result.ts'
import type { Selector, SelectorData } from './selector.ts'

/** An op's data (an event's, or an action's result). */
type DataOf<O> = O extends Op<any, infer S> ? S extends TSchema ? Static<S> : unknown : unknown

/** One call edge from the pod. Nothing on it throws. */
export type Selection<I extends Interface> = {
  readonly pod: string
  readonly runtime: string
  readonly call: Client<I>
  on<O extends I['ops'][keyof I['ops']]>(op: O, fn: (data: DataOf<O>) => void | Promise<void>): () => void
}

export type NanoContext<D extends Record<string, Selector> = Record<string, Selector>> = {
  readonly self: string
  readonly runtimes: readonly string[]
  /** One plain object per declared dependency role, typed from its interface. */
  readonly deps: { readonly [K in keyof D]: D[K] extends Interface ? Interface.Type<D[K]> : Record<string, (input?: unknown) => Promise<unknown>> }
  one<I extends Interface>(s: I | SelectorData): NanoResult<Selection<I>>
  all<I extends Interface>(s: I | SelectorData): Selection<I>[]
  publish<O extends Op>(o: O, data: DataOf<O>): Promise<void>
  addOnCloseListener(fn: (e: { reason: 'restarted' | 'removed' | 'changed' | 'closed' }) => void | Promise<void>): void
}
