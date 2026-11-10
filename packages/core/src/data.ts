// The plain data of the core: names for operations and places, results, events, subscriptions and changes.
import { Type, type Static, type TSchema } from 'typebox'

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

const str = (description: string, examples?: string[]) => Type.String({ description, ...(examples && { examples }) })

/** A named connection: when `source` (or any, '*') publishes `op`, call `listener`'s `target` action with the data. */
export const SubscriptionSchema = Type.Object({
  id: str('The subscription id'), source: str("The publishing instance, or '*' for any", ['ex-range']),
  op: str('The published op, by key', ['composable.bundle/range/value']), listener: str('The instance called', ['ex-log']),
  target: str("The listener's action, by key", ['composable.bundle/log/info']),
}, { title: 'Subscription', description: 'A connection from a published op to an action' })
export type Subscription = Static<typeof SubscriptionSchema>

/** Who added an instance to a registry: the one that will remove it (a record only; nothing acts on it). */
export const OwnerSchema = Type.Object({ kind: str('What kind of thing owns it', ['platform', 'widget', 'view', 'editor', 'app']), name: str('Which one', ['platform', 'c-range']) },
  { title: 'Owner', description: 'Who added an instance to a registry' })
export type Owner = Static<typeof OwnerSchema>

const instance = str('The instance id', ['ex-range']), ops = Type.Array(Type.String(), { description: "The instance's ops, by key" })
/** Each kind of change to a registry, as published by the registry itself. */
export const DeltaSchemas = {
  'instance-added': Type.Object({ type: Type.Literal('instance-added'), instance, ops, component: str('Its component id, ns/name', ['composable.bundle/range']),
    description: Type.Optional(str("Its component's description")), owner: Type.Optional(OwnerSchema) }, { description: 'An instance was added' }),
  'instance-removed': Type.Object({ type: Type.Literal('instance-removed'), instance, ops }, { description: 'An instance was removed' }),
  'op-added': Type.Object({ type: Type.Literal('op-added'), instance, op: str('The op, by key') }, { description: 'An instance gained an op' }),
  'op-removed': Type.Object({ type: Type.Literal('op-removed'), instance, op: str('The op, by key') }, { description: 'An instance lost an op' }),
  'subscription-opened': Type.Object({ type: Type.Literal('subscription-opened'), subscription: SubscriptionSchema }, { description: 'A subscription was opened' }),
  'subscription-closed': Type.Object({ type: Type.Literal('subscription-closed'), subscription: SubscriptionSchema }, { description: 'A subscription was closed' }),
}
/** A change to a registry, published from the registry itself. */
export const DeltaSchema = Type.Union(Object.values(DeltaSchemas), { title: 'Delta', description: 'A change to a registry' })
export type Delta = Static<(typeof DeltaSchemas)[keyof typeof DeltaSchemas]>
