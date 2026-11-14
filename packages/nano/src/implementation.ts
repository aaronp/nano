/**
 * Implementations: code that provides interfaces, made per instance from its config into a map of handlers by port key.
 *
 *   const memDb = implementation('acme/mem/db', {
 *     provides: [DB],
 *     make: config => [provide(DB, { get: async (ctx, key) => success(store.get(key)) })],
 *   })
 */
import { COORD, portKey, type Client, type Interface } from './iface.ts'
import type { NanoContext } from './context.ts'
import type { NanoResult } from './result.ts'
import type { SchemaDef } from './schema.ts'
import { selectorData, type Selector, type SelectorData } from './selector.ts'

export type Handler = (ctx: NanoContext, input: unknown) => Promise<NanoResult<unknown>>

/** One handler per action and sink, typed as the Client's call with the context in front. Sources have none: they are published. */
export type Handlers<I extends Interface> = {
  [K in keyof Client<I>]: Client<I>[K] extends (input: infer A) => infer R ? (ctx: NanoContext, input: A) => R : never
}

/** One interface's handlers, keyed by port key. Opaque: only `implementation` reads it. */
export type Provided = { readonly iface: Interface; readonly handlers: ReadonlyMap<string, Handler> }

export function provide<I extends Interface>(i: I, handlers: Handlers<I>): Provided {
  const byName = handlers as Record<string, Handler | undefined>
  const out = new Map<string, Handler>()
  for (const o of Object.values(i.ops)) {
    const h = o.kind === 'source' ? undefined : byName[o.name]
    if (h) out.set(portKey(i.coord, o.coord), h)
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
  make(config: unknown): Promise<ReadonlyMap<string, Handler>>
}

type Spec = {
  provides: Interface[]
  dependencies?: Record<string, Selector>
  config?: SchemaDef
  description?: string
  make(config: unknown): Provided[] | Promise<Provided[]>
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
    async make(config) {
      const declared = new Set(spec.provides.map(i => i.coord))
      const given = new Set<string>()
      const out = new Map<string, Handler>()
      for (const part of await spec.make(config)) {
        const ic = part.iface.coord
        if (!declared.has(ic)) throw new Error(`${coord}: ${ic} is not provided`)
        if (given.has(ic)) throw new Error(`${coord}: ${ic} is provided twice`)
        given.add(ic)
        for (const [port, h] of part.handlers) out.set(port, h)
      }
      for (const i of spec.provides)
        for (const o of Object.values(i.ops))
          if (o.kind !== 'source' && !out.has(portKey(i.coord, o.coord))) throw new Error(`${coord}: missing ${i.coord}/${o.name}`)
      return out
    },
  }
}
