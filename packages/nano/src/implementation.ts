/**
 * Implementations: code that provides whole interfaces. Its factory `make(ctx, config)` runs once per build and returns
 * the handlers by port; state is whatever the factory closes over, and handlers take only their input.
 *
 *   const memDb = implementation('acme/mem/db', {
 *     provides: [DB],
 *     make: (ctx, config) => { const m = new Map(); return [provide(DB, { get: async key => success(m.get(key)) })] },
 *   })
 */
import { COORD, port, type Client, type Interface } from './iface.ts'
import type { NanoContext } from './context.ts'
import type { NanoResult } from './result.ts'
import type { SchemaDef } from './schema.ts'
import { selectorData, type Selector, type SelectorData } from './selector.ts'

export type Handler = (input: unknown) => Promise<NanoResult<unknown>>

/** One handler per action, typed as the Client's call. Events have none: they are published. */
export type Handlers<I extends Interface> = Client<I>

/** One interface's handlers, keyed by port. Opaque: only `implementation` reads it. */
export type Provided = { readonly iface: Interface; readonly handlers: ReadonlyMap<string, Handler> }

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
  make(ctx: NanoContext, config: unknown): Promise<ReadonlyMap<string, Handler>>
}

type Spec = {
  provides: Interface[]
  dependencies?: Record<string, Selector>
  config?: SchemaDef
  description?: string
  make(ctx: NanoContext, config: any): Provided[] | Promise<Provided[]>
}

export function implementation(coord: string, spec: Spec): Implementation {
  const slash = coord.lastIndexOf('/')
  if (!COORD.test(coord) || slash < 0) throw new Error(`bad implementation coordinate ${coord}`)
  return {
    coord,
    provider: coord.slice(0, slash),
    provides: spec.provides,
    dependencies: Object.fromEntries(Object.entries(spec.dependencies ?? {}).map(([role, s]) => [role, selectorData(s)])),
    ...(spec.config && { config: spec.config }),
    ...(spec.description !== undefined && { description: spec.description }),
    async make(ctx, config) {
      const declared = new Set(spec.provides.map(i => i.coord))
      const given = new Set<string>()
      const out = new Map<string, Handler>()
      for (const part of await spec.make(ctx, config)) {
        const ic = part.iface.coord
        if (!declared.has(ic)) throw new Error(`${coord}: ${ic} is not provided`)
        if (given.has(ic)) throw new Error(`${coord}: ${ic} is provided twice`)
        given.add(ic)
        for (const [p, h] of part.handlers) out.set(p, h)
      }
      for (const i of spec.provides)
        for (const o of Object.values(i.ops))
          if (o.kind !== 'event' && !out.has(port(i, o))) throw new Error(`${coord}: missing ${port(i, o)}`)
      return out
    },
  }
}
