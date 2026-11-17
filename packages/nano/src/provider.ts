/**
 * Providers: a namespace of implementations, plus free-form metadata.
 *
 *   const mem = Provider.define('acme/mem', [memDb, memLog], { author: 'acme' })
 *   mem.implementations.get('acme/mem/db')   // memDb
 *
 * The package's `Coord` is layer 1's with a namespace that also builds (layer 2): `ns.interface(name, ops)` is
 * `Interface.define(ns.interfaceId(name), ops)` and `ns.provider(impls, meta?)` is `Provider.define(ns, impls, meta)`.
 *
 *   const acme = Coord.namespace('acme'); const DB = acme.interface('DB', { get: Op.action(Key, Value) })
 */
import { Coord as Pure, type Namespace } from './coord.ts'
import { Interface } from './iface.ts'
import type { Implementation } from './implementation.ts'

export type Provider = {
  readonly coord: string
  readonly implementations: ReadonlyMap<string, Implementation>
  readonly meta: Readonly<Record<string, string>>
}

function define(at: string | Namespace, implementations: Implementation[], meta: Record<string, string> = {}): Provider {
  const coord = String(at)
  const byCoord = new Map<string, Implementation>()
  for (const i of implementations) {
    if (i.provider !== coord) throw new Error(`${i.coord} is not under ${coord}`)
    if (byCoord.has(i.coord)) throw new Error(`${i.coord} is listed twice`)
    byCoord.set(i.coord, i)
  }
  return { coord, implementations: byCoord, meta }
}

/** `Provider.define(ns, implementations, meta?)`: `ns` a `Namespace` or its string. */
export const Provider = { define }

type Ops = Parameters<typeof Interface.define>[1]
function namespace(name: string) {
  const pure = Pure.namespace(name)
  // Its coordinates point back at this namespace, not layer 1's.
  const ns = Object.freeze({
    ...pure,
    // Typed as layer 1's coordinates: their `ns` is this namespace at runtime, but a self-referencing type would be
    // elided to `any` in the emitted .d.ts (and the published types would break).
    interfaceId: (n: string): ReturnType<typeof pure.interfaceId> => Object.freeze({ ...pure.interfaceId(n), ns }),
    implementationId: (n: string): ReturnType<typeof pure.implementationId> => Object.freeze({ ...pure.implementationId(n), ns }),
    interface: <U extends Ops>(n: string, ops: U) => Interface.define<U>(ns.interfaceId(n), ops),
    provider: (implementations: Implementation[], meta?: Record<string, string>) => define(ns, implementations, meta),
  })
  return ns
}

/** Layer 1's `Coord`, its `namespace` also building interfaces and providers. */
export const Coord = { ...Pure, namespace }
