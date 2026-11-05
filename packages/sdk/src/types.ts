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

export const InstanceRef = Type.Object({
  namespace: Type.Array(Type.String(), {
    description: 'Path of container instance names from the root.', examples: [['root', 'pair-1']],
  }),
  instance: Type.String({ description: 'Instance name within the namespace.', examples: ['button-1'] }),
}, { title: 'InstanceRef', description: 'Structured address of a running component instance.' })
export type InstanceRef = Static<typeof InstanceRef>

export const Instance = Type.Object({
  namespace: InstanceRef.properties.namespace,
  instance: InstanceRef.properties.instance,
  manifest: Manifest,
}, { title: 'Instance', description: 'A running component instance: its address plus its manifest.' })
export type Instance = Static<typeof Instance>

export const EventRef = Type.Object({
  instance: InstanceRef,
  event: Type.String({ description: 'Event name.', examples: ['clicked'] }),
}, { title: 'EventRef', description: 'Reference to an event on a specific instance.' })
export type EventRef = Static<typeof EventRef>

export const ActionRef = Type.Object({
  instance: InstanceRef,
  action: Type.String({ description: 'Action name.', examples: ['log'] }),
}, { title: 'ActionRef', description: 'Reference to an action on a specific instance.' })
export type ActionRef = Static<typeof ActionRef>

export const Policy = <T extends TSchema>(item: T) => Type.Union([
  Type.Object({ type: Type.Literal('allow'), values: Type.Array(item, { description: 'Permitted values.' }) },
    { description: 'Only the listed values are permitted.' }),
  Type.Object({ type: Type.Literal('deny'), values: Type.Array(item, { description: 'Forbidden values.' }) },
    { description: 'Everything except the listed values is permitted.' }),
  Type.Object({ type: Type.Literal('all') }, { description: 'Everything is permitted.' }),
], { description: 'Allow-list, deny-list, or allow-all policy.' })
export type Policy<T> =
  | { type: 'allow'; values: T[] }
  | { type: 'deny'; values: T[] }
  | { type: 'all' }

export type Environment =
  | { type: 'leaf'; instance: Instance }
  | { type: 'node'; instance: Instance; children: Environment[] }
export const Environment = Type.Unsafe<Environment>(Type.Cyclic({
  Environment: Type.Union([
    Type.Object({ type: Type.Literal('leaf'), instance: Instance }, { description: 'An instance with no children.' }),
    Type.Object({
      type: Type.Literal('node'), instance: Instance,
      children: Type.Array(Type.Ref('Environment'), { description: 'Child environments.' }),
    }, { description: 'An instance hosting children.' }),
  ]),
}, 'Environment', { title: 'Environment', description: 'Tree of instances visible to a component.' }))

export const Capabilities = Type.Object({
  environment: Environment,
  events: Policy(EventRef),
  actions: Policy(ActionRef),
}, { title: 'Capabilities', description: 'What a component can see, and which events and actions it may use.' })
export type Capabilities = Static<typeof Capabilities>

export const SystemError = Type.Object({
  code: Type.Unsafe<SystemErrorCode>(Type.Union(
    ['validation', 'unknown-target', 'unknown-action', 'loop', 'timeout', 'handler', 'bridge'].map(c => Type.Literal(c)),
    { description: 'Machine-readable failure category.' })),
  message: Type.String({ description: 'Human-readable explanation (display only).' }),
}, { title: 'SystemError', description: 'A failure reported by the system rather than thrown.' })
export type SystemError = Static<typeof SystemError>
export type SystemErrorCode = 'validation' | 'unknown-target' | 'unknown-action' | 'loop' | 'timeout' | 'handler' | 'bridge'

export type Invocation = {
  id: string; from: Instance; target: InstanceRef; action: string; input: unknown; stack: Invocation[]
}
export const Invocation = Type.Unsafe<Invocation>(Type.Cyclic({
  Invocation: Type.Object({
    id: Type.String({ description: 'Unique invocation id.' }),
    from: Instance,
    target: InstanceRef,
    action: Type.String({ description: 'Action name being invoked.' }),
    input: Type.Unknown({ description: 'Action input, validated against the action schema.' }),
    stack: Type.Array(Type.Ref('Invocation'), { description: 'Enclosing invocations, used for loop detection.' }),
  }),
}, 'Invocation', { title: 'Invocation', description: 'One in-flight action call, with the stack of calls that led to it.' }))

export type Result<T> =
  | { type: 'success'; data: T }
  | { type: 'not-allowed'; reason: string }
  | { type: 'error'; error: SystemError }

// TS-only: functions are not schemas.
export type Scope = { stack: Invocation[] }
/** Intents: what a component asks its context to do. Wrappers (`withEmit` / `withCall`) see and transform these. */
export type Emitted = { event: Event; payload: unknown; scope: Scope }
export type Called = { target: InstanceRef; action: Action; input: unknown; scope: Scope }
export type EmitFn = (e: Emitted) => Promise<Result<void>>
export type CallFn = (c: Called) => Promise<Result<unknown>>

/** Typed views of EventDef / ActionDef: the schema types flow into emit, call and handlers. */
export type Event<S extends TSchema = TSchema> = { name: string; schema: S; description?: string }
export type Action<I extends TSchema = TSchema, O extends TSchema | undefined = TSchema | undefined> =
  { name: string; input: I; output?: O; description?: string }
export type Output<A extends Action> = A extends Action<any, infer O> ? (O extends TSchema ? Static<O> : unknown) : unknown

/**
 * What a component acts through. Authors use the typed `emit` / `call`; a parent derives a child's context with
 * `withEmit` / `withCall` / `withCapabilities`, each wrapper getting the intent and `next`. The last wrapper added
 * runs first, so a child's own wrappers run before the ones its parent gave it.
 */
export interface Context {
  readonly self: Instance
  capabilities(): Capabilities
  emit<E extends Event>(event: E, payload: Static<E['schema']>): Promise<Result<void>>
  call<A extends Action>(target: InstanceRef, action: A, input: Static<A['input']>): Promise<Result<Output<A>>>
  withEmit(fn: (e: Emitted, next: EmitFn) => Promise<Result<void>>): Context
  withCall(fn: (c: Called, next: CallFn) => Promise<Result<unknown>>): Context
  withCapabilities(fn: (c: Capabilities) => Capabilities): Context
}

/** Receives actions. Emitting is the other half (a source), done through `Context.emit`. */
export type DataSink = { onAction(ctx: Context, inv: Invocation): Promise<Result<unknown>> }
export type Component = DataSink & { dispose?(): void | Promise<void> }

export type Route = { from: EventRef; to: ActionRef }
/** What a container may do with its own subtree: add children under itself and wire them. */
export type Host = {
  register(factory: ComponentFactory, name: string, wrap?: (c: Context) => Context): Promise<Instance>
  route(r: Route): void
  component(ref: InstanceRef): Component | undefined
}
export type ComponentFactory = {
  manifest: Manifest
  create(ctx: Context, self: Instance, host: Host): Component | Promise<Component>
}

export const defineManifest = <const M extends Manifest>(m: M): M => m
export const sameInstance = (a: InstanceRef, b: InstanceRef) =>
  a.instance === b.instance && a.namespace.length === b.namespace.length && a.namespace.every((n, i) => n === b.namespace[i])
export const ok = <T>(data: T): Result<T> => ({ type: 'success', data })
export const notAllowed = (reason: string): Result<never> => ({ type: 'not-allowed', reason })
export const fail = (code: SystemErrorCode, message: string): Result<never> => ({ type: 'error', error: { code, message } })
export const allows = <T>(p: Policy<T>, v: T, eq: (a: T, b: T) => boolean): boolean =>
  p.type === 'all' ? true : p.type === 'allow' ? p.values.some(x => eq(x, v)) : !p.values.some(x => eq(x, v))
