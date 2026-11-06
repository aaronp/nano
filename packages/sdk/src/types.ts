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
export type OpDef = Op

export const Manifest = Type.Object({
  id: ComponentId,
  ops: Type.Array(OpDef, { description: 'Everything this component handles, publishes or can consume.' }),
}, { title: 'Manifest', description: 'Declares a component\'s operations.' })
export type Manifest = { id: ComponentId; ops: Op[] }

export const Instance = Type.Object({
  name: Type.String({ description: 'Instance name, unique within its context.', examples: ['slider'] }),
  manifest: Manifest,
}, { title: 'Instance', description: 'A running component in a context: its name plus its manifest.' })
export type Instance = Static<typeof Instance>

const ERROR_CODES = ['validation', 'unknown-target', 'unknown-action', 'loop', 'handler'] as const
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
 * An operation, typed: the schemas flow into publish, subscribe, call and handlers.
 * Input and output: an action. Output only: a publication. Input only: a subscription.
 */
export type Op<I extends TSchema | undefined = TSchema | undefined, O extends TSchema | undefined = TSchema | undefined> =
  { name: string; description?: string; input?: I; output?: O }
export type Publication = Op<undefined, TSchema>
export type Input<P extends Op> = P extends Op<infer I, any> ? (I extends TSchema ? Static<I> : never) : never
export type Output<P extends Op> = P extends Op<any, infer O> ? (O extends TSchema ? Static<O> : unknown) : unknown
export type Role = 'action' | 'publication' | 'subscription'
export const roleOf = (op: Op): Role => op.input ? (op.output ? 'action' : 'subscription') : 'publication'

/**
 * Correlation: every trigger (bootstrap, a host call, a UI publish, a mount) starts one; everything done in
 * response carries it. Components never handle it; contexts carry it for them.
 */
export type Invocation = { from: string; target: string; op: string; input: unknown; correlation: string }
export type Delivered = { from: string; op: string; correlation: string }
/** What a subscriber learns besides the payload; `ctx` is its own context, carrying the publication's correlation. */
export type Delivery = Delivered & { ctx: Context }

/** Intents: what a context is asked to do. `with*` wrappers see and transform these. */
export type Published = { op: Op; payload: unknown; correlation: string }
export type Called = { target: string; op: Op; input: unknown; correlation: string }
export type Subscribed = { op: Op; from?: string; fn: (payload: unknown, d: Delivered) => unknown }
export type PublishFn = (p: Published) => Promise<Result<void>>
export type CallFn = (c: Called) => Promise<Result<unknown>>
export type SubscribeFn = (s: Subscribed) => () => void

/**
 * What a component acts through: its manifest, the instances it can see, and publish / subscribe / call.
 * `correlation` is fixed for a mount or handler context, and undefined for an app context (each operation then
 * starts a new one). A parent derives a child's context with the `with*` wrappers; the last added runs first.
 */
export interface Context {
  readonly self: string
  readonly manifest: Manifest
  readonly correlation?: string
  publish<P extends Publication>(op: P, payload: Output<P>): Promise<Result<void>>
  /** Receive `op`'s publications (from anyone, or only `opts.from`). Synchronous delivery; returns unsubscribe. */
  subscribe<P extends Op>(op: P, fn: (payload: Output<P>, d: Delivery) => unknown, opts?: { from?: string }): () => void
  call<P extends Op<TSchema, TSchema | undefined>>(target: string, op: P, input: Input<P>): Promise<Result<Output<P>>>
  instances(): Instance[]
  /** Called now and whenever instances are added or removed. */
  watch(fn: (instances: Instance[]) => void): () => void
  /** The same context carrying `correlation` (for containers forwarding work across their boundary). */
  within(correlation: string): Context
  withPublish(fn: (p: Published, next: PublishFn) => Promise<Result<void>>): Context
  withCall(fn: (c: Called, next: CallFn) => Promise<Result<unknown>>): Context
  withSubscribe(fn: (s: Subscribed, next: SubscribeFn) => () => void): Context
}

/** What a component gets when it is created: `mountContext` for reacting to the mount, `appContext` to keep. */
export type Mount = { mountContext: Context; appContext: Context }

/** Handles every op that has an input, whether it arrives by `call` or is fed from a publication. */
export type Component = { onAction(ctx: Context, inv: Invocation): Promise<Result<unknown>>; dispose?(): void | Promise<void> }
export type ComponentFactory<C extends Component = Component> = {
  manifest: Manifest
  create(m: Mount): C | Promise<C>
}
/** The component a factory creates (what `scope.add` resolves to). */
export type Created<F extends ComponentFactory<any>> = Awaited<ReturnType<F['create']>>

/** Why `from`'s `publication` cannot feed `to`'s `op`, or undefined if it can. */
export const routeProblem = (from: Manifest | undefined, publication: Op, to: Manifest | undefined, op: Op, names = { from: 'source', to: 'target' }) => {
  const p = from?.ops.find(o => o.name === publication.name), t = to?.ops.find(o => o.name === op.name)
  if (!from) return `no instance "${names.from}"`
  if (!to) return `no instance "${names.to}"`
  if (!p || roleOf(p) !== 'publication') return `"${names.from}" does not publish ${publication.name}`
  if (!t?.input) return `"${names.to}" has no op ${op.name} taking input`
}

export const ok = <T>(data: T): Result<T> => ({ type: 'success', data })
export const notAllowed = (reason: string): Result<never> => ({ type: 'not-allowed', reason })
export const fail = (code: SystemErrorCode, message: string): Result<never> => ({ type: 'error', error: { code, message } })
