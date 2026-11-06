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

export const EventDef = Type.Object({
  name: Type.String({ description: 'Qualified event name, `author/component/event`.', examples: ['acme/button/clicked'] }),
  schema: AnySchema,
  description: Type.Optional(Type.String({ description: 'What the event means, for people choosing what to allow.' })),
}, { title: 'EventDef', description: 'An event a component can emit, with the schema of its payload.' })
export type EventDef = Static<typeof EventDef>

export const ActionDef = Type.Object({
  name: Type.String({ description: 'Qualified action name, `author/component/action`.', examples: ['acme/logger/log'] }),
  input: AnySchema,
  output: Type.Optional(AnySchema),
  description: Type.Optional(Type.String({ description: 'What the action does, for people choosing what to allow.' })),
}, { title: 'ActionDef', description: 'An action a component can handle, with input and optional output schemas.' })
export type ActionDef = Static<typeof ActionDef>

export const Manifest = Type.Object({
  id: ComponentId,
  version: Type.String({ description: 'Semantic version of the component.', examples: ['0.1.0'] }),
  emits: Type.Array(EventDef, { description: 'Events this component may emit.' }),
  consumes: Type.Array(ActionDef, { description: 'Actions this component handles.' }),
}, { title: 'Manifest', description: 'Declares what a component emits and consumes.' })
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

/** One step of a causal chain: who sent which event or action. `stack` lists these, oldest (the origin) first. */
export type Frame = { from: string; name: string }
export type Invocation = { id: string; from: string; target: string; action: string; input: unknown; stack: Frame[] }
/** What a subscriber learns about an event besides its payload; `ctx` is the subscriber's, carrying the stack. */
export type Delivery = { from: string; event: string; stack: Frame[]; ctx: Context }

/** Typed views of EventDef / ActionDef: the schema types flow into emit, call, on and handlers. */
export type Event<S extends TSchema = TSchema> = { name: string; schema: S; description?: string }
export type Action<I extends TSchema = TSchema, O extends TSchema | undefined = TSchema | undefined> =
  { name: string; input: I; output?: O; description?: string }
export type Output<A extends Action> = A extends Action<any, infer O> ? (O extends TSchema ? Static<O> : unknown) : unknown

/** Intents: what a context is asked to do. `with*` wrappers see and transform these. */
export type Emitted = { event: Event; payload: unknown; stack: Frame[] }
export type Called = { target: string; action: Action; input: unknown; stack: Frame[] }
export type Subscribed = { event: Event; from?: string; fn: (payload: unknown, d: Delivery) => unknown }
export type EmitFn = (e: Emitted) => Promise<Result<void>>
export type CallFn = (c: Called) => Promise<Result<unknown>>
export type OnFn = (s: Subscribed) => () => void

/**
 * What a component acts through: a bus (`emit` / `on`), the instances it can see, and `call`.
 * A parent derives a child's context with the `with*` wrappers; the last added runs first.
 */
export interface Context {
  readonly self: string
  emit<E extends Event>(event: E, payload: Static<E['schema']>): Promise<Result<void>>
  /** Listen for `event` (from anyone, or only `opts.from`). Delivery is synchronous; returns unsubscribe. */
  on<E extends Event>(event: E, fn: (payload: Static<E['schema']>, d: Delivery) => unknown, opts?: { from?: string }): () => void
  call<A extends Action>(target: string, action: A, input: Static<A['input']>): Promise<Result<Output<A>>>
  instances(): Instance[]
  /** Called now and whenever instances are added or removed. */
  watch(fn: (instances: Instance[]) => void): () => void
  withEmit(fn: (e: Emitted, next: EmitFn) => Promise<Result<void>>): Context
  withCall(fn: (c: Called, next: CallFn) => Promise<Result<unknown>>): Context
  withOn(fn: (s: Subscribed, next: OnFn) => () => void): Context
  withInstances(fn: (list: Instance[]) => Instance[]): Context
}

/** Receives actions. Emitting is the other half (a source), done through `Context.emit`. */
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
