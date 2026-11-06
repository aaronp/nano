import Type, { type Static, type TSchema } from 'typebox'

/** Any JSON schema (a TypeBox schema after structuredClone is still a plain object). */
const AnySchema = Type.Unsafe<TSchema>(
  Type.Object({}, { description: 'A TypeBox / JSON schema object.' }),
)

export const ComponentId = Type.Object({
  author: Type.String({ description: 'Publisher of the component.', examples: ['acme'] }),
  id: Type.String({ description: 'Component identifier, unique per author.', examples: ['button'] }),
}, { title: 'ComponentId', description: 'Identity of a component type (not of a running instance).' })
export type ComponentId = Static<typeof ComponentId>

export const OpDef = Type.Object({
  name: Type.String({ description: 'Qualified name, `author/component/op`.', examples: ['acme/chart/push'] }),
  description: Type.Optional(Type.String({ description: 'What it does or means, for people choosing what to allow.' })),
  input: Type.Optional(AnySchema),
  output: Type.Optional(AnySchema),
}, {
  title: 'OpDef',
  description: 'An operation. Input and output: an action. Output only: a publication. Input only: a subscription.',
})
export type OpDef = Static<typeof OpDef>

export const Manifest = Type.Object({
  id: ComponentId,
  ops: Type.Array(OpDef, { description: 'Everything this component handles, publishes or can consume.' }),
}, { title: 'Manifest', description: 'Declares a component\'s operations.' })
export type Manifest = Static<typeof Manifest>

export const Instance = Type.Object({
  name: Type.String({ description: 'Instance name, unique within its context.', examples: ['slider'] }),
  manifest: Manifest,
}, { title: 'Instance', description: 'A running component in a context: its name plus its manifest.' })
export type Instance = Static<typeof Instance>

export const SystemError = Type.Object({
  code: Type.Unsafe<SystemErrorCode>(Type.Union(
    ['validation', 'unknown-target', 'unknown-action', 'loop', 'timeout', 'handler', 'bridge'].map(c => Type.Literal(c)),
    { description: 'Machine-readable failure category.' })),
  message: Type.String({ description: 'Human-readable explanation (display only).' }),
}, { title: 'SystemError', description: 'A failure reported by the system rather than thrown.' })
export type SystemError = Static<typeof SystemError>
export type SystemErrorCode = 'validation' | 'unknown-target' | 'unknown-action' | 'loop' | 'timeout' | 'handler' | 'bridge'

export type Result<T> =
  | { type: 'success'; data: T }
  | { type: 'not-allowed'; reason: string }
  | { type: 'error'; error: SystemError }

/** One step of a causal chain: who published or called which op. `stack` lists these, oldest (the origin) first. */
export type Frame = { from: string; name: string }
export type Invocation = { id: string; from: string; target: string; op: string; input: unknown; stack: Frame[] }
/** What a subscriber learns besides the payload; `ctx` is the subscriber's own, carrying the stack. */
export type Delivery = { from: string; op: string; stack: Frame[]; ctx: Context }

/** A typed OpDef: the schema types flow into publish, subscribe, call and handlers. */
export type Op<I extends TSchema | undefined = TSchema | undefined, O extends TSchema | undefined = TSchema | undefined> =
  { name: string; description?: string; input?: I; output?: O }
export type Input<P extends Op> = P extends Op<infer I, any> ? (I extends TSchema ? Static<I> : never) : never
export type Output<P extends Op> = P extends Op<any, infer O> ? (O extends TSchema ? Static<O> : unknown) : unknown
export type Role = 'action' | 'publication' | 'subscription'
export const roleOf = (op: OpDef): Role => op.input ? (op.output ? 'action' : 'subscription') : 'publication'

/** Intents: what a context is asked to do. `with*` wrappers see and transform these. */
export type Published = { op: Op; payload: unknown; stack: Frame[] }
export type Called = { target: string; op: Op; input: unknown; stack: Frame[] }
export type Subscribed = { from?: string; op: Op; fn: (payload: unknown, d: Delivery) => unknown }
export type PublishFn = (p: Published) => Promise<Result<void>>
export type CallFn = (c: Called) => Promise<Result<unknown>>
export type SubscribeFn = (s: Subscribed) => () => void

/**
 * What a component acts through: its manifest, the instances it can see, and publish / subscribe / call.
 * A parent derives a child's context with the `with*` wrappers; the last added runs first.
 */
export interface Context {
  readonly self: string
  readonly manifest: Manifest
  publish<P extends Op>(op: P, payload: Output<P>): Promise<Result<void>>
  /** Receive `op`'s publications from `from` (undefined: from anyone). Synchronous delivery; returns unsubscribe. */
  subscribe<P extends Op>(from: string | undefined, op: P, fn: (payload: Output<P>, d: Delivery) => unknown): () => void
  call<P extends Op>(target: string, op: P, input: Input<P>): Promise<Result<Output<P>>>
  instances(): Instance[]
  /** Called now and whenever instances are added or removed. */
  watch(fn: (instances: Instance[]) => void): () => void
  withPublish(fn: (p: Published, next: PublishFn) => Promise<Result<void>>): Context
  withCall(fn: (c: Called, next: CallFn) => Promise<Result<unknown>>): Context
  withSubscribe(fn: (s: Subscribed, next: SubscribeFn) => () => void): Context
  withInstances(fn: (list: Instance[]) => Instance[]): Context
}

/** Handles every op that has an input, whether it arrives by `call` or is fed from a publication. */
export type DataSink = { onAction(ctx: Context, inv: Invocation): Promise<Result<unknown>> }
export type Component = DataSink & { dispose?(): void | Promise<void> }
export type ComponentFactory = {
  manifest: Manifest
  create(ctx: Context): Component | Promise<Component>
}

export const defineManifest = <const M extends Manifest>(m: M): M => m
export const ok = <T>(data: T): Result<T> => ({ type: 'success', data })
export const notAllowed = (reason: string): Result<never> => ({ type: 'not-allowed', reason })
export const fail = (code: SystemErrorCode, message: string): Result<never> => ({ type: 'error', error: { code, message } })
