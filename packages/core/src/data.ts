// The plain data of the core: names for operations and places, results, events, subscriptions and changes.
import type { TSchema } from 'typebox'

type S = TSchema | undefined

/** A named operation a component offers. With input and output it is an action, output only a source, input only a sink. */
export type Op<I extends S = S, O extends S = S> = { ns: string; name: string; input?: I; output?: O }

/** Makes ops and names them. */
export const Ops = {
  action: <I extends TSchema, O extends TSchema>(ns: string, name: string, input: I, output: O): Op<I, O> => ({ ns, name, input, output }),
  source: <O extends TSchema>(ns: string, name: string, output: O): Op<undefined, O> => ({ ns, name, output }),
  sink: <I extends TSchema>(ns: string, name: string, input: I): Op<I, undefined> => ({ ns, name, input }),
  /** The op's coordinate, used wherever an op is referred to by name. */
  key: (op: Pick<Op, 'ns' | 'name'>): string => `${op.ns}/${op.name}`,
}

/** Where an instance lives: a registry and an instance id within it. */
export type Coord = { registry: string; instance: string }

/** The outcome of anything that can fail: a value, or an error message. */
export type Result<A = unknown> = { value: A; detail?: unknown } | { error: string; detail?: unknown }

/** A success. */
export const ok = <A>(value: A, detail?: unknown): Result<A> => (detail === undefined ? { value } : { value, detail })
/** A failure, with a message. */
export const err = (error: string, detail?: unknown): Result<never> => (detail === undefined ? { error } : { error, detail })
/** Whether a Result is a success. */
export const isOk = <A>(r: Result<A>): r is { value: A; detail?: unknown } => 'value' in r

/** Something an instance published: who, which op (by key), and the data. */
export type Event = { from: Coord; op: string; data: unknown; correlation?: string }

/** A named connection: when `source` (or any, '*') publishes `op`, call `listener`'s `target` action with the data. */
export type Subscription = { id: string; source: string; op: string; listener: string; target: string }

/** A change to a registry, published from the registry itself. */
export type Delta =
  | { type: 'instance-added' | 'instance-removed'; instance: string; ops: string[] }
  | { type: 'op-added' | 'op-removed'; instance: string; op: string }
  | { type: 'subscription-opened' | 'subscription-closed'; subscription: Subscription }
