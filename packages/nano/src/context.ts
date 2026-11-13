/**
 * The context a handler runs in: which instance, in which runtime, with what config, and the verbs it calls out with.
 *
 *   const h: Handler = async (ctx, msg) => ctx.one(DB, db => db.save({ key: 'k', value: msg }))
 *   await ctx.publish(Ticks.ops.tick, 1)        // to every live event subscription, in every runtime it belongs to
 *   ctx.hasDependencies('store')                // false: no live connection matches the declared selector
 */
import type { Client, Interface } from './iface.ts'
import type { Op } from './op.ts'
import type { Fail, NanoResult } from './result.ts'
import type { SelectorData } from './selector.ts'

/** A value and the instance that gave it. */
export type Found<T> = { value: T; from: string }
export type Each<T> = { from: string; result: NanoResult<T> }[]
/** An interface (typed client), `sel(I, …)`, or plain selector data (client built from the target's interface). */
export type CallSelector<I extends Interface> = I | (SelectorData & { implements?: string })
export type Call<I extends Interface, T> = (c: Client<I>) => Promise<NanoResult<T>>

export type NanoContext = {
  readonly instance: string
  readonly runtime: string
  readonly config: unknown
  one<I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>): Promise<NanoResult<T>>
  optional<I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>): Promise<NanoResult<Found<T> | { none: true }>>
  any<I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>): Promise<NanoResult<Found<T>>>
  all<I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>): Promise<Each<T>>
  first<I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>): Promise<NanoResult<T>>
  fallback<I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>): Promise<NanoResult<Found<T> & { failures: { from: string; fail: Fail }[] }>>
  each<I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>): Promise<Each<T>>
  publish(op: Op, data: unknown): Promise<void>
  hasDependencies(role?: string): boolean
  listDependencies(): { role: string; selector: SelectorData; satisfied: boolean; targets: string[] }[]
}
