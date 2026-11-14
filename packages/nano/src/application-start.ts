/**
 * What an application saves and starts from: the shapes of a runtime and of a pod as saved, and the pods table, where
 * each key is made once, application-wide, and the same pod registered at its saved coord in every runtime started.
 *
 *   const pods = podsTable(registry, note)
 *   pods.check({ pods: { p0: { implementation: 'acme/keys/vault' } }, runtimes: [] })   // why not, or undefined
 *   pods.fill(rt, def, added) // each entry registered at its coord, then the subscriptions; what cannot be, a note
 *   pods.live(rt)             // a started runtime as data, its pods keyed application-wide
 */
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { COORD } from './iface.ts'
import { Pod } from './pod.ts'
import { Policies } from './policy.ts'
import type { Registry } from './registry.ts'
import { failure, type NanoResult } from './result.ts'
import { ID, MAX_PODS, MAX_RUNTIMES, MAX_SUBSCRIPTIONS, type Runtime, type SubscriptionData } from './runtime/index.ts'
import { isJson } from './schema.ts'

const Id = Type.String({ pattern: ID.source })
const Impl = Type.String({ pattern: COORD.source })
const Coord = Type.String({ pattern: `^${COORD.source.slice(1, -1)}#(0|[1-9][0-9]{0,8})$` }) // COORD is anchored and flagless
const Port = Type.String({ minLength: 1 })

/** What a `RuntimeDef` must be: `define` checks it, and the document holds runtimes of this shape. */
export const RuntimeDefSchema = Type.Object({
  id: Id,
  policy: Type.Optional(Type.Literal('allow-all')),
  pods: Type.Array(Type.Object({ coord: Coord, pod: Id }), { maxItems: MAX_PODS }),
  next: Type.Record(Impl, Type.Integer({ minimum: 0, maximum: 1e9 }), { additionalProperties: false }),
  subscriptions: Type.Array(Type.Union([
    Type.Object({ id: Id, kind: Type.Literal('call'), from: Coord, to: Coord }),
    Type.Object({ id: Id, kind: Type.Literal('event'), from: Coord, source: Port, to: Coord, target: Port }),
  ]), { maxItems: MAX_SUBSCRIPTIONS }),
})
const DefinitionSchema = Type.Object({
  pods: Type.Record(Id, Type.Object({ implementation: Impl, config: Type.Optional(Type.Unknown()) }), { additionalProperties: false }),
  runtimes: Type.Array(RuntimeDefSchema, { maxItems: MAX_RUNTIMES }),
})

/** A pod as saved, under its key in the pods table: what `Pod.create` is given. */
export type PodDef = { implementation: string; config?: unknown }
/** A runtime as saved: the pods it holds (coord and pods-table key, register order), its counters, its subscriptions in order. */
export type RuntimeDef = {
  id: string
  policy?: 'allow-all'
  pods: { coord: string; pod: string }[]
  next: Record<string, number>
  subscriptions: SubscriptionData[]
}
type Definition = { pods: Record<string, PodDef>; runtimes: RuntimeDef[] }

const podDef = (p: Pod): PodDef => ({ implementation: p.implementation, ...(p.config !== undefined && { config: structuredClone(p.config) }) })

/** The application's pods table and the pods made from it so far. `note` hears what a start skips. */
export function podsTable(registry: Registry, note: (reason: string) => void) {
  const table = new Map<string, PodDef>()
  // ponytail: a made or keyed pod is held for the application's life; drop it when no runtime holds it if that matters.
  const made = new Map<string, Pod>(), keys = new Map<Pod, string>()
  let fresh = 0
  /** A live pod's key, given on first ask (one the table does not use). */
  const keyOf = (p: Pod) => {
    let k = keys.get(p)
    if (k === undefined) {
      do k = `p${fresh++}`; while (table.has(k) || made.has(k))
      keys.set(p, k); made.set(k, p)
    }
    return k
  }
  /** The pod behind a key, made now if it is not yet (`fresh`); or why there is none. */
  const podOf = (key: string): { pod: Pod; fresh: boolean } | string => {
    const have = made.get(key)
    if (have) return { pod: have, fresh: false }
    const d = table.get(key)
    if (!d) return `no pod ${key} in the pods table`
    const impl = registry.implementation(d.implementation)
    if (!impl) return `no implementation ${d.implementation}`
    const p = Pod.create(impl, { config: d.config })
    made.set(key, p); keys.set(p, key)
    return { pod: p, fresh: true }
  }
  return {
    /** Why a definition cannot be taken (its shape, a config not JSON, a key the application has), or undefined. */
    check(d: Definition): NanoResult<never> | undefined {
      const e = Value.Errors(DefinitionSchema, d)[0]
      if (e) return failure('invalid-input', `bad definition: ${e.instancePath || '/'}: ${e.message}`)
      for (const [k, p] of Object.entries(d.pods)) {
        if (p.config !== undefined && !isJson(p.config)) return failure('invalid-input', `${k}: config is not JSON`)
        if (table.has(k)) return failure('exists', `pod key ${k} exists`)
      }
    },
    /** Its own copy: a later edit to `pods` never changes what starts. */
    add(pods: Record<string, PodDef>) {
      for (const [k, p] of Object.entries(structuredClone(pods))) {
        table.set(k, p)
        const live = made.get(k) // a key given to a live pod (never one of the table's): that pod takes another
        if (live) { made.delete(k); keys.delete(live); keyOf(live) }
      }
    },
    /** A key's entry: its pod as it is now once made, else as defined. */
    entry(key: string): PodDef | undefined { const p = made.get(key), d = table.get(key); return p ? podDef(p) : d && structuredClone(d) },
    /** `added` hears each coord registered, so a start that throws can take back exactly those. */
    fill(rt: Runtime, def: RuntimeDef, added: string[]) {
      for (const { coord, pod } of def.pods) {
        const p = podOf(pod), r = typeof p === 'string' ? failure('not-found', p) : rt.register(p.pod, coord)
        if (r.ok) { added.push(r.value); continue }
        note(`${def.id}/${coord}: ${r.fail.reason}`)
        if (typeof p !== 'string' && p.fresh) { made.delete(pod); keys.delete(p.pod); void p.pod.dispose() } // made for nothing
      }
      for (const s of def.subscriptions) { const r = rt.subscribe(s); if (!r.ok) note(`${def.id}/${s.id}: ${r.fail.reason}`) }
    },
    live(rt: Runtime): Definition {
      const pods: Record<string, PodDef> = {}
      const refs = rt.pods().map(coord => { const p = rt.pod(coord)!, pod = keyOf(p); pods[pod] = podDef(p); return { coord, pod } })
      return { pods, runtimes: [{
        id: rt.id, ...(rt.policy === Policies.allowAll() && { policy: 'allow-all' as const }),
        pods: refs, next: { ...rt.next() }, subscriptions: rt.subscriptions().map(s => ({ ...s })),
      }] }
    },
  }
}
