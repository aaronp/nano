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
  requires: Type.Optional(Type.Array(Type.String(), { description: 'Names of the dependencies (see Manifest.dependencies) this op needs to run.' })),
}, {
  title: 'OpDef',
  description: 'An operation. Input and output: an action. Output only: a publication. Input only: a subscription.',
})
export type OpDef = Op

export const Dependency = Type.Object({
  name: Type.String({ description: 'Local name, used by ops in `requires`.', examples: ['enrich'] }),
  description: Type.Optional(Type.String()),
  op: OpDef,
  components: Type.Optional(Type.Array(ComponentId, { description: 'Only these components may provide it (default: any).' })),
}, {
  title: 'Dependency',
  description: 'An op this component calls on another: any instance with an op of the same shape (input and output SAIDs) provides it.',
})
export type Dependency = { name: string; description?: string; op: Op; components?: ComponentId[] }

export const Manifest = Type.Object({
  id: ComponentId,
  ops: Type.Array(OpDef, { description: 'Everything this component handles, publishes or can consume.' }),
  dependencies: Type.Optional(Type.Array(Dependency, { description: 'Ops of other components this one calls.' })),
}, { title: 'Manifest', description: 'Declares a component\'s operations, and what it needs from others.' })
export type Manifest = { id: ComponentId; ops: Op[]; dependencies?: Dependency[] }

export const Instance = Type.Object({
  id: Type.String({ description: 'Instance id, unique within each System it is registered in.', examples: ['slider'] }),
  manifest: Manifest,
}, { title: 'Instance', description: 'A component instance registered in a System: its id plus its manifest.' })
export type InstanceId = string
export type Instance = { id: InstanceId; manifest: Manifest }

const ERROR_CODES = ['validation', 'unknown-target', 'unknown-action', 'unavailable', 'loop', 'handler'] as const
export type SystemErrorCode = (typeof ERROR_CODES)[number]
export const SystemError = Type.Object({
  code: Type.Unsafe<SystemErrorCode>(Type.Union(ERROR_CODES.map(c => Type.Literal(c)), { description: 'Machine-readable failure category.' })),
  message: Type.String({ description: 'Human-readable explanation (display only).' }),
}, { title: 'SystemError', description: 'A failure reported by the system rather than thrown.' })
export type SystemError = Static<typeof SystemError>

export type Result<T> =
  | { type: 'success'; data: T }
  | { type: 'not-allowed'; reason: string }
  | { type: 'error'; error: SystemError }

/**
 * An operation, typed: the schemas flow into notify, subscribe, call and handlers.
 * Input and output: an action. Output only: a source (it notifies). Input only: a sink.
 */
export type Op<I extends TSchema | undefined = TSchema | undefined, O extends TSchema | undefined = TSchema | undefined> =
  { name: string; description?: string; input?: I; output?: O; requires?: string[] }
export type Source = Op<undefined, TSchema>
export type Input<P extends Op> = P extends Op<infer I, any> ? (I extends TSchema ? Static<I> : never) : never
export type Output<P extends Op> = P extends Op<any, infer O> ? (O extends TSchema ? Static<O> : unknown) : unknown
export type Role = 'action' | 'source' | 'sink'
export const roleOf = (op: Op): Role => op.input ? (op.output ? 'action' : 'sink') : 'source'

// ---------------------------------------------------------------- systems

/** A System's data: its instances, and the manifest of each component type present (one per type). */
export type System = { id: string; manifest: Manifest[]; instances: Instance[] }
/** What changed in a System. `manifest` only when the set of component types present changes. */
export type SystemDelta =
  | { type: 'added'; instances: Instance[] }
  | { type: 'removed'; instances: Instance[] }
  | { type: 'manifest'; manifest: Manifest[] }

/**
 * Correlation: every trigger (a call or notify through a handle that carries none) starts one; everything done in
 * response carries it. `via`: for a call fed by a link, the output op of `from` that fed it.
 */
export type Invocation = { system: string; from: InstanceId; target: InstanceId; op: string; input: unknown; correlation: string; via?: string }
export type Delivered = { system: string; from: InstanceId; op: string; correlation: string }
/** What a subscriber gets besides the payload; `handle` is its own, carrying the notification's correlation. */
export type Delivery = Delivered & { handle: SystemInstance }

/** Intents: what a handle is asked to do. `with*` wrappers see and transform these. */
export type Notified = { op: Op; payload: unknown; correlation: string }
export type Called = { target: InstanceId; op: Op; input: unknown; correlation: string; via?: string }
export type Subscribed = { op: Op; from?: InstanceId; fn: (payload: unknown, d: Delivered) => unknown }
export type NotifyFn = (n: Notified) => Promise<Result<void>>
export type CallFn = (c: Called) => Promise<Result<unknown>>
export type SubscribeFn = (s: Subscribed) => () => void

/**
 * What a component holds for each System it is registered in, and acts through. A handle given to `onAction` or a
 * delivery carries the correlation of what triggered it; one kept and used later starts a new correlation per
 * operation. Wrappers (`with*`) derive a handle that intercepts; the last added runs first.
 */
export interface SystemInstance {
  readonly system: System
  readonly instanceId: InstanceId
  readonly correlation?: string
  notify<P extends Source>(op: P, payload: Output<P>): Promise<Result<void>>
  call<P extends Op<TSchema, TSchema | undefined>>(target: InstanceId, op: P, input: Input<P>): Promise<Result<Output<P>>>
  /** Receive `op`'s outputs (notifications, or an action's outcomes) from anyone, or only `opts.from`. Returns unsubscribe. */
  subscribe<P extends Op>(op: P, fn: (payload: Output<P>, d: Delivery) => unknown, opts?: { from?: InstanceId }): () => void
  /** Call whatever this instance's dependency `name` is bound to in this System; `unavailable` if unbound. */
  use(name: string, input: unknown): Promise<Result<unknown>>
  /** The same handle carrying `correlation` (for containers forwarding work across their boundary). */
  within(correlation: string): SystemInstance
  withNotify(fn: (n: Notified, next: NotifyFn) => Promise<Result<void>>): SystemInstance
  withCall(fn: (c: Called, next: CallFn) => Promise<Result<unknown>>): SystemInstance
  withSubscribe(fn: (s: Subscribed, next: SubscribeFn) => () => void): SystemInstance
}

/**
 * A component instance: its manifest, a handler for every op with an input (by call, or fed by a link), and
 * optionally the SystemAware hooks. It acts only through the handles it is given.
 */
export interface Component {
  readonly manifest: Manifest
  onAction(s: SystemInstance, inv: Invocation): Promise<Result<unknown>>
  onAddedToSystem?(s: SystemInstance): void
  onRemovedFromSystem?(systemId: string): void
  onSystemUpdated?(systemId: string, delta: SystemDelta): void
  dispose?(): void | Promise<void>
}
export type ComponentFactory<C extends Component = Component> = { manifest: Manifest; create(): C | Promise<C> }
/** The component a factory creates. */
export type Created<F extends ComponentFactory<any>> = Awaited<ReturnType<F['create']>>

/** Why `from`'s `output` (publication or action outcome) cannot feed `to`'s `op`, or undefined if it can. */
export const routeProblem = (from: Manifest | undefined, output: Op, to: Manifest | undefined, op: Op, names = { from: 'source', to: 'target' }) => {
  const p = from?.ops.find(o => o.name === output.name), t = to?.ops.find(o => o.name === op.name)
  if (!from) return `no instance "${names.from}"`
  if (!to) return `no instance "${names.to}"`
  if (!p?.output) return `"${names.from}" has no op ${output.name} giving output`
  if (!t?.input) return `"${names.to}" has no op ${op.name} taking input`
}

export const ok = <T>(data: T): Result<T> => ({ type: 'success', data })
export const notAllowed = (reason: string): Result<never> => ({ type: 'not-allowed', reason })
export const fail = (code: SystemErrorCode, message: string): Result<never> => ({ type: 'error', error: { code, message } })
