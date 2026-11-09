// Rune-style sugar over @composable/core: write plain state and functions; get an ordinary core Component.
import { Type, type Static, type TSchema, type TUnknown } from 'typebox'
import { Components, Ops, type Component, type Environment, type Op } from '@composable/core'

/** The instance whose `make` is running: what state writes mark dirty, and where events publish. */
type Making = { dirty(): void; env?: Environment }
let making: Making | undefined
const EVENT = Symbol('event')
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
export function event<S extends TSchema = TUnknown>(schema?: S): (data: Static<S>) => void {
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

/**
 * A component from a function returning its surface: functions become actions, getters become sources published
 * when their value changes, and `event()` members become sources. `make` runs once here to read the shape.
 */
export function component<A extends object>(id: string, make: () => A, schemas: { [K in keyof A]?: TSchema } = {}): Component<A> & { ops: { [K in keyof A]: Op } } {
  const kinds = new Map<string, Kind>(), ops: Record<string, Op> = {}
  for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(run(make, { dirty() {} })))) {
    const given = (schemas as Record<string, TSchema | undefined>)[k], mark = d.value?.[EVENT] as EventMark | undefined
    if (d.get) { kinds.set(k, 'getter'); ops[k] = Ops.source(id, k, given ?? Type.Unknown()) }
    else if (mark) { kinds.set(k, 'event'); ops[k] = Ops.source(id, k, given ?? mark.schema ?? Type.Unknown()) }
    else if (typeof d.value === 'function') { kinds.set(k, 'action'); ops[k] = Ops.action(id, k, given ?? Type.Unknown(), Type.Unknown()) }
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
  })
  for (const [k, kind] of kinds) {
    if (kind === 'getter') c.action(ops[k]!, a => copy(JSON.stringify((a as any)[k])))
    else if (kind === 'event') c.action(ops[k]!)
    else c.action(ops[k]!, (a, arg) => { const r = (a as any)[k](arg); return targets.has(r) ? clone(r) : r })
  }
  return Object.assign(c, { ops: ops as { [K in keyof A]: Op } })
}
