/**
 * The registry: a pool of providers, answering lookups by coord in O(1) and describing itself as a plain-data manifest.
 *
 *   const r = Registry.create()
 *   r.add(mem)                        // NanoResult<void>; fails `invalid-input` on a clash
 *   r.implementationsOf('acme/db')    // [memDb]
 */
import type { Interface } from './iface.ts'
import type { Implementation } from './implementation.ts'
import type { Op, OpKind } from './op.ts'
import type { Provider } from './provider.ts'
import { failure, success, type NanoResult } from './result.ts'
import type { SelectorData } from './selector.ts'

export type Manifest = {
  providers: { coord: string; implementations: string[] }[]
  implementations: { coord: string; provides: string[]; dependencies: Record<string, SelectorData> }[]
  interfaces: { coord: string; ops: { name: string; kind: OpKind; coord: string; input?: string; output?: string }[] }[]
}

export type Registry = {
  add(p: Provider): NanoResult<void>
  manifest(): Manifest
  provider(coord: string): Provider | undefined
  implementation(coord: string): Implementation | undefined
  implementationsOf(ifaceCoord: string): readonly Implementation[]
  interface(coord: string): Interface | undefined
  op(coord: string): Op | undefined
}

const opSet = (i: Interface) => [...i.byCoord.keys()].sort().join()
const byCoord = (a: { coord: string }, b: { coord: string }) => (a.coord < b.coord ? -1 : a.coord > b.coord ? 1 : 0)

function create(): Registry {
  const providers = new Map<string, Provider>()
  const impls = new Map<string, Implementation>()
  const ifaces = new Map<string, Interface>()
  const ops = new Map<string, Op>()
  const implsOf = new Map<string, Implementation[]>()

  return {
    add(p) {
      // An implementation's coord fixes its provider and a provider lists each once, so a new provider brings no clashing implementation.
      if (providers.has(p.coord)) return failure('invalid-input', `provider ${p.coord} is already registered`)
      // Check everything before writing anything, so a clash adds nothing.
      const seen = new Map<string, Interface>()
      for (const impl of p.implementations.values()) {
        for (const i of impl.provides) {
          const known = ifaces.get(i.coord) ?? seen.get(i.coord)
          if (known && opSet(known) !== opSet(i)) return failure('invalid-input', `interface ${i.coord} differs`)
          seen.set(i.coord, known ?? i)
        }
      }
      providers.set(p.coord, p)
      for (const impl of p.implementations.values()) {
        impls.set(impl.coord, impl)
        for (const i of impl.provides) {
          if (!ifaces.has(i.coord)) ifaces.set(i.coord, i)
          for (const o of i.byCoord.values()) if (!ops.has(o.coord)) ops.set(o.coord, o)
          implsOf.set(i.coord, [...(implsOf.get(i.coord) ?? []), impl])
        }
      }
      return success(undefined)
    },
    manifest: () => ({
      providers: [...providers.values()].sort(byCoord).map(p => ({ coord: p.coord, implementations: [...p.implementations.keys()].sort() })),
      implementations: [...impls.values()].sort(byCoord).map(i => ({
        coord: i.coord,
        provides: i.provides.map(x => x.coord).sort(),
        dependencies: structuredClone(i.dependencies) as Record<string, SelectorData>,
      })),
      interfaces: [...ifaces.values()].sort(byCoord).map(i => ({
        coord: i.coord,
        ops: Object.values(i.ops).map(o => ({
          name: o.name, kind: o.kind, coord: o.coord,
          ...(o.input && { input: o.input.hash }),
          ...(o.output && { output: o.output.hash }),
        })),
      })),
    }),
    provider: c => providers.get(c),
    implementation: c => impls.get(c),
    implementationsOf: c => implsOf.get(c) ?? [],
    interface: c => ifaces.get(c),
    op: c => ops.get(c),
  }
}

/** `Registry.create()`. */
export const Registry = { create }
