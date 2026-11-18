/**
 * Implementations: code that provides whole interfaces. Its factory `make(ctx, config)` runs once per build and returns
 * the handlers by port; state is whatever the factory closes over. A handler takes its input and the invocation's
 * context (`ctx.callingOp`, `ctx.deps`): calls through it continue the invoking message's chain.
 *
 *   const memDb = Implementation.define('acme/mem/db', {
 *     provides: [DB],
 *     make: (ctx, config) => { const m = new Map(); return [provide(DB, { get: async key => success(m.get(key)) })] },
 *   })
 *   Implementation.define('acme/mem/db', { provides: [DB], dependencies: { log: Log },
 *     make: ({ deps }) => ({ get: async key => { await deps.log.record(key); return null } }) })   // one interface: a plain object
 */
import { COORD, port, type Client, type Interface } from './iface.ts'

const isInterface = (s: Selector) => ('ops' in s ? s as Interface : undefined)
import type { NanoContext } from './context.ts'
import type { ImplCoord } from './coord.ts'
import type { Op } from './op.ts'
import type { NanoResult } from './result.ts'
import type { SchemaDef } from './schema.ts'
import { lift, plain } from './plain.ts'
import { selectorData, type Selector, type SelectorData } from './selector.ts'

/** A handler: its input, and the invocation's context (`callingOp`; its calls continue the invoking message's chain). */
export type Handler = (input: unknown, ctx?: Omit<NanoContext, 'deps'>) => Promise<NanoResult<unknown>>

/** One handler per action, typed as the Client's call, with the invocation's context. Events have none: they are published. */
export type Handlers<I extends Interface> = { [K in keyof Client<I>]: (input: Parameters<Client<I>[K]>[0], ctx?: NanoContext) => ReturnType<Client<I>[K]> }

/** A source: an event's method on a plain object, which the application runs once per build (`application/sources.ts`). */
export type Source = { readonly op: Op; run(): AsyncIterable<unknown> }

/** One interface's handlers and sources, keyed by port. Opaque: only `implementation` reads it. */
export type Provided = { readonly iface: Interface; readonly handlers: ReadonlyMap<string, Handler>; readonly sources?: ReadonlyMap<string, Source> }

export function provide<I extends Interface>(i: I, handlers: Handlers<I>): Provided {
  const byName = handlers as Record<string, Handler | undefined>
  const out = new Map<string, Handler>()
  for (const o of Object.values(i.ops)) {
    const h = o.kind === 'event' ? undefined : byName[o.name]
    if (h) out.set(port(i, o), h)
  }
  return { iface: i, handlers: out }
}

export type Implementation = {
  readonly coord: string
  readonly provider: string
  readonly provides: readonly Interface[]
  readonly dependencies: Readonly<Record<string, SelectorData>>
  readonly config?: SchemaDef
  readonly description?: string
  /** `ctx` without `deps`: they are made here from `dependencies`. It gives the build's handlers (by port) and its
   *  sources (by port), which the application starts, publishes, stops at close, and traces when they throw. */
  make(ctx: Omit<NanoContext, 'deps'>, config: unknown): Promise<{ handlers: ReadonlyMap<string, Handler>; sources: ReadonlyMap<string, Source> }>
}

/** A plain object for `I`: its event (source) methods are optional, as an event may be published through `ctx`. */
type Plain<I extends Interface, D extends Record<string, Selector>, T = Interface.Type<I>> =
  { [K in keyof T as I['ops'][K & string]['kind'] extends 'event' ? never : K]:
    T[K] extends (...a: infer A) => infer R ? (input: A extends [infer X] ? X : null, ctx?: NanoContext<D>) => R : never } &
  { [K in keyof T as I['ops'][K & string]['kind'] extends 'event' ? K : never]?: T[K] }

/** `provide(...)` parts, or for a single interface its plain object (lifted by `handlers`; sources published). */
type Made<P, D extends Record<string, Selector>> = Provided[] | (P extends readonly [infer One extends Interface] ? Plain<One, D> : never)

type Spec<P extends readonly Interface[], D extends Record<string, Selector>> = {
  provides: [...P]
  dependencies?: D
  config?: SchemaDef
  description?: string
  make(ctx: NanoContext<D>, config: any): Made<P, D> | Promise<Made<P, D>>
}

function define<const P extends readonly Interface[], D extends Record<string, Selector> = {}>(at: string | ImplCoord, spec: Spec<P, D>): Implementation {
  const coord = String(at)
  const slash = coord.lastIndexOf('/')
  if (!COORD.test(coord) || slash < 0) throw new Error(`bad implementation coordinate ${coord}`)
  return {
    coord,
    provider: coord.slice(0, slash),
    provides: spec.provides,
    dependencies: Object.fromEntries(Object.entries(spec.dependencies ?? {}).map(([role, s]) => [role, selectorData(s)])),
    ...(spec.config && { config: spec.config }),
    ...(spec.description !== undefined && { description: spec.description }),
    async make(base, config) {
      // The factory's ctx and each invocation's alike: `deps` over that context's `one`.
      const withDeps = (c: Omit<NanoContext, 'deps'>) => Object.assign(Object.create(c), { deps: Object.fromEntries(Object.keys(spec.dependencies ?? {}).map(role =>
        [role, plain(isInterface(spec.dependencies![role]), () => c.one(selectorData(spec.dependencies![role]!)))])) }) as NanoContext<D>
      const ctx = withDeps(base)
      const made = await spec.make(ctx, config)
      if (!Array.isArray(made) && spec.provides.length !== 1) throw new Error(`${coord}: a plain object provides exactly one interface`)
      const parts = Array.isArray(made) ? made : [lift(spec.provides[0]!, made as object)]
      const declared = new Set(spec.provides.map(i => i.coord))
      const given = new Set<string>()
      const out = new Map<string, Handler>(), sources = new Map<string, Source>()
      for (const part of parts) {
        const ic = part.iface.coord
        if (!declared.has(ic)) throw new Error(`${coord}: ${ic} is not provided`)
        if (given.has(ic)) throw new Error(`${coord}: ${ic} is provided twice`)
        given.add(ic)
        for (const [p, h] of part.handlers) out.set(p, (input, inv) => h(input, inv && withDeps(inv)))
        for (const [p, src] of part.sources ?? []) sources.set(p, src)
      }
      for (const i of spec.provides)
        for (const o of Object.values(i.ops))
          if (o.kind !== 'event' && !out.has(port(i, o))) throw new Error(`${coord}: missing ${port(i, o)}`)
      return { handlers: out, sources }
    },
  }
}

/** `Implementation.define(coord, spec)`. */
export const Implementation = { define }
