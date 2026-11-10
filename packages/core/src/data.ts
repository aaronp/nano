// The plain data of the core: names for operations and places, results, events, subscriptions and changes.
import type { TSchema } from 'typebox'

type S = TSchema | undefined

/** A named operation a component offers. With input and output it is an action, output only a source, input only a sink. */
export type Op<I extends S = S, O extends S = S> = { ns: string; name: string; input?: I; output?: O; description?: string }
/** What an op is for, in a sentence. */
export type OpOptions = { description?: string }
const described = (o: OpOptions = {}) => (o.description === undefined ? {} : { description: o.description })

const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as Record<string, unknown>)[k])]))
  : v

/** A value as JSON with sorted keys: equal data gives equal strings (schemas included). */
export const canonical = (value: unknown): string => JSON.stringify(sorted(value))

/** Keys that describe a schema without constraining it: `fits` ignores them (a title still names a type). */
const ANNOTATIONS = new Set(['description', 'examples', '$comment'])
const bare = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(bare)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !ANNOTATIONS.has(k)).map(([k, x]) => [k, bare(x)]))
  : v

/** A schema that accepts any value: no constraints besides, at most, a name and annotations. */
const anything = (s: TSchema) => Object.keys(s).every(k => k === 'title' || ANNOTATIONS.has(k))

/** Makes ops and names them. */
export const Ops = {
  action: <I extends TSchema, O extends TSchema>(ns: string, name: string, input: I, output: O, o?: OpOptions): Op<I, O> => ({ ns, name, input, output, ...described(o) }),
  source: <O extends TSchema>(ns: string, name: string, output: O, o?: OpOptions): Op<undefined, O> => ({ ns, name, output, ...described(o) }),
  sink: <I extends TSchema>(ns: string, name: string, input: I, o?: OpOptions): Op<I, undefined> => ({ ns, name, input, ...described(o) }),
  /** The op's coordinate, used wherever an op is referred to by name. */
  key: (op: Pick<Op, 'ns' | 'name'>): string => `${op.ns}/${op.name}`,
  /** Can what `from` outputs be given to `to`? Its input takes anything, or is the same type, name included. */
  fits: (from: Op, to: Op): boolean =>
    !!from.output && !!to.input && (anything(to.input) || canonical(bare(from.output)) === canonical(bare(to.input))),
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
  | { type: 'instance-added'; instance: string; ops: string[]; component: string; description?: string; owner?: { kind: string; name: string } }
  | { type: 'instance-removed'; instance: string; ops: string[] }
  | { type: 'op-added' | 'op-removed'; instance: string; op: string }
  | { type: 'subscription-opened' | 'subscription-closed'; subscription: Subscription }
