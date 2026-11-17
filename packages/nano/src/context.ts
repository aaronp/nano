/**
 * The context a pod's factory gets. It belongs to the pod, not to a call: `one` and `all` read the deployment as it is
 * now, over the call subscriptions from `self` in every runtime the pod is placed in, each a `Selection`.
 *
 *   const kv = ctx.one(KeyValueStore)            // NanoResult<Selection>: a Fail (not-found, not-unique) unless exactly one is wired
 *   if (kv.ok) await kv.value.call.put('k')      // through that edge
 *   if (kv.ok) kv.value.on(KeyValueStore.ops.changed, ({ output }) => …)   // hear that pod's event (typed by the op) while this build lives
 *   for await (const { input } of kv.value.on(KeyValueStore.ops.put)) …   // the same, as an AsyncIterable; both connect (or throw) here
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
type InOf<O> = O extends Op<infer S, any> ? S extends TSchema ? Static<S> : unknown : unknown
/** What `on` gets: `{ input, output }` of an action's successful call, `{ output }` of an event. */
type Emission<O> = O extends { kind: 'event' } ? { output: DataOf<O> } : { input: InOf<O>; output: DataOf<O> }

/**
 * One call edge from the pod. `call` never throws: each call gives a `NanoResult`. `on` subscribes, and it behaves the
 * same in both forms (and as the host's `subscribe` does):
 * - it connects **at the call**: it hears every emission from that line on;
 * - it **throws at the call** an `Error` carrying the `Fail` (`err.fail`) when it can't connect: `denied` (the runtime's
 *   policy refuses `'subscribe'`), `not-found` (the edge is gone, or this build is closed) or `unknown-op`;
 * - subscribing and its end are messages on the runtime's stream (`sent` kind `subscribe` / `unsubscribe`).
 */
export type Selection<I extends Interface> = {
  readonly pod: string
  readonly runtime: string
  readonly call: Client<I>
  /** `fn` hears each emission until the returned unsubscribe is called, the build closes, `apply` removes the edge, or a
   *  later `apply`'s policy refuses it (seen on the stream as `unsubscribe` with `denied`). */
  on<O extends I['ops'][keyof I['ops']]>(op: O, fn: (e: Emission<O>) => void | Promise<void>): () => void
  /** The same emissions as an AsyncIterable, iterated once. `break` unsubscribes; it is `done` when the build closes or
   *  the edge goes, and throws the `Fail` (after what it had received) when a later `apply`'s policy refuses it. */
  on<O extends I['ops'][keyof I['ops']]>(op: O): AsyncIterable<Emission<O>>
}

export type NanoContext<D extends Record<string, Selector> = Record<string, Selector>> = {
  readonly self: string
  readonly runtimes: readonly string[]
  /** One plain object per declared dependency role, typed from its interface. */
  readonly deps: { readonly [K in keyof D]: D[K] extends Interface ? Interface.Type<D[K]> : Record<string, (input?: any) => Promise<any>> }
  one<I extends Interface>(s: I | SelectorData): NanoResult<Selection<I>>
  all<I extends Interface>(s: I | SelectorData): Selection<I>[]
  publish<O extends Op>(o: O, data: DataOf<O>): Promise<void>
  /** `fn` hears each other pod added to or removed from a runtime this pod is placed in, from now on, until this build closes. Needs the policy's `'lifecycle'`. */
  addOnPodChangeListener(fn: (e: { type: 'added' | 'removed'; runtime: string; pod: string; implementation: string }) => void | Promise<void>): void
  addOnCloseListener(fn: (e: { reason: 'restarted' | 'removed' | 'changed' | 'closed' }) => void | Promise<void>): void
}
