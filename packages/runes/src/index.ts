// Rune-style sugar over @pritzlaff/nano-core: write plain state and functions; get an ordinary core Component.
import { Type, type Static, type TSchema, type TUnknown } from 'typebox'
import { Components, Ops, type Component, type Environment, type Op } from '@pritzlaff/nano-core'

/** The instance whose `make` is running: what state writes mark dirty, and where events publish. */
type Making = { dirty(): void; env?: Environment }
let making: Making | undefined
const EVENT: unique symbol = Symbol('event')
type EventMark = { schema?: TSchema; bind(op: Op): void }

const copy = (json: string | undefined) => (json === undefined ? undefined : JSON.parse(json))
const inMake = (what: string) => { if (!making) throw new Error(`${what}() must be called while a component's make function runs`); return making }

const targets = new WeakMap<object, object>()   // every state proxy → the object it wraps
/** State is JSON-shaped data: only arrays and plain, unfrozen objects are tracked. Map, Set, Date stay as they are. */
const plain = (v: unknown): v is object =>
  v !== null && typeof v === 'object' && !Object.isFrozen(v) && (Array.isArray(v) || [Object.prototype, null].includes(Object.getPrototypeOf(v)))
/** A deep copy of plain data, unwrapping any state proxies inside it. Other objects (Map, Date) are kept as they are. */
const clone = (v: unknown): unknown => {
  const t = (v !== null && typeof v === 'object' && targets.get(v)) || v
  if (!plain(t)) return t
  return Array.isArray(t) ? t.map(clone) : Object.fromEntries(Object.entries(t).map(([k, x]) => [k, clone(x)]))
}

/** Wraps an object (and everything inside it) so every write marks the owner dirty. */
function reactive<T extends object>(target: T, dirty: () => void, seen: WeakMap<object, object>): T {
  if (!plain(target)) return target
  const cached = seen.get(target)
  if (cached) return cached as T
  const p = new Proxy(target, {
    get: (t, k, r) => { const v = Reflect.get(t, k, r); return plain(v) ? reactive(v, dirty, seen) : v },
    set: (t, k, v, r) => {
      // store a copy: state never shares an object with the caller, or with another place in state
      const ok = Reflect.set(t, k, clone(v), r); dirty(); return ok
    },
    deleteProperty: (t, k) => { const ok = Reflect.deleteProperty(t, k); dirty(); return ok },
  })
  seen.set(target, p)
  targets.set(p, target)
  return p
}

/** Reactive state for the component being made: any write, at any depth, re-publishes the getters that changed. */
export function state<T extends object>(init: T): T {
  const m = inMake('state')
  return reactive(clone(init) as T, () => m.dirty(), new WeakMap())   // a copy: instances never share state
}

/** A source that is not state, such as a click: calling it publishes a copy of its argument. */
export function event<S extends TSchema = TUnknown>(schema?: S): ((data: Static<S>) => void) & { readonly [EVENT]: EventMark } {
  const m = inMake('event')
  let op: Op | undefined
  const fire = (data: Static<S>) => { if (op && m.env) void m.env.notify(op, copy(JSON.stringify(data))) }
  const mark: EventMark = { schema, bind: o => { op = o } }
  return Object.assign(fire, { [EVENT]: mark })
}

/** Runs `make` with `m` as the instance being made. */
function run<A>(make: () => A, m: Making): A {
  const prev = making
  making = m
  try { return make() } finally { making = prev }
}

type Kind = 'getter' | 'event' | 'action'

/** An action's types and what it does. No `in`: it takes anything and ignores it. No `out`: it returns nothing. */
export type ActionSpec = { in?: TSchema; out?: TSchema; description: string }
type Fn = (...a: any[]) => any
/** What `component()` takes for each key: a schema for a getter or event (its output), a spec for an action. */
export type Schemas<A> = { [K in keyof A]?: A[K] extends { readonly [EVENT]: EventMark } ? TSchema : A[K] extends Fn ? ActionSpec | TSchema : TSchema }
// each given schema must agree with the code: a getter's schema describes its value, an action's `in` its argument
type Agrees<V, S> =
  V extends { readonly [EVENT]: EventMark } ? S
  : V extends Fn ? (S extends { in: infer I extends TSchema } ? ([Static<I>] extends [Parameters<V>[0]] ? S : { in: 'does not match the parameter type' }) : S)
  : S extends TSchema ? ([Static<S>] extends [V] ? S : 'schema does not match the getter type') : S
type Checked<A, S> = { [K in keyof S]: K extends keyof A ? Agrees<A[K], S[K]> : never }

const IGNORED = Type.Unknown({ description: 'Ignored: any value triggers it' })
const isSchema = (v: unknown): v is TSchema => !!v && typeof v === 'object' && '~kind' in v
const about = (s?: TSchema) => { const d = (s as { description?: string } | undefined)?.description; return d === undefined ? {} : { description: d } }

/**
 * A component from a function returning its surface: functions become actions, getters become sources published
 * when their value changes, and `event()` members become sources. `make` runs once here to read the shape.
 */
export function component<A extends object, S extends Schemas<A> = Schemas<A>>(id: string, make: () => A, schemas: S & Checked<A, S> = {} as S & Checked<A, S>,
  opts: { description?: string } = {}): Component<A> & { ops: { [K in keyof A]: Op } } {
  const kinds = new Map<string, Kind>(), ops: Record<string, Op> = {}
  for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(run(make, { dirty() {} })))) {
    const given = (schemas as Record<string, TSchema | ActionSpec | undefined>)[k], mark = d.value?.[EVENT] as EventMark | undefined
    const schema = isSchema(given) ? given : undefined
    if (d.get) { kinds.set(k, 'getter'); const out = schema ?? Type.Unknown(); ops[k] = Ops.source(id, k, out, about(out)) }
    else if (mark) { kinds.set(k, 'event'); const out = schema ?? mark.schema ?? Type.Unknown(); ops[k] = Ops.source(id, k, out, about(out)) }
    else if (typeof d.value === 'function') {
      kinds.set(k, 'action')
      const spec: Partial<ActionSpec> = schema ? { in: schema } : (given as ActionSpec | undefined) ?? {}   // ponytail: a bare schema for an action goes once every caller is annotated
      ops[k] = Ops.action(id, k, spec.in ?? IGNORED, spec.out ?? Type.Void(), spec.description === undefined ? {} : { description: spec.description })
    }
  }
  const getters = [...kinds].filter(([, kind]) => kind === 'getter').map(([k]) => k)
  const at = id.lastIndexOf('/')
  if (at < 1) throw new Error(`component id ${id} needs a namespace, like acme/${id}`)
  const c = Components.create<A>({ ns: id.slice(0, at), name: id.slice(at + 1) }, env => {
    const last = new Map<string, string | undefined>()
    let pending = false
    const read = (k: string) => JSON.stringify((api as any)[k])
    const flush = () => {
      try {
        for (const k of getters) {
          let now: string | undefined
          try { now = read(k) } catch { continue }   // a failing getter is skipped; calling it reports the error
          if (now !== last.get(k)) { last.set(k, now); void env.notify(ops[k]!, copy(now)) }
        }
      } finally { pending = false }   // after the loop: writes made by getters don't schedule another flush
    }
    const api = run(make, { env, dirty: () => { if (!pending) { pending = true; queueMicrotask(flush) } } })
    for (const k of getters) { try { last.set(k, read(k)) } catch {} }
    for (const [k, kind] of kinds) if (kind === 'event') ((api as any)[k][EVENT] as EventMark).bind(ops[k]!)
    return api
  }, opts)
  for (const [k, kind] of kinds) {
    if (kind === 'getter') c.action(ops[k]!, a => copy(JSON.stringify((a as any)[k])))
    else if (kind === 'event') c.action(ops[k]!)
    else c.action(ops[k]!, (a, arg) => { const r = (a as any)[k](arg); return targets.has(r) ? clone(r) : r })
  }
  return Object.assign(c, { ops: ops as { [K in keyof A]: Op } })
}
