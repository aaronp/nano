/**
 * Pods: the id rule, instance coords `<pod>#<n>`, the pod record (owned by its home runtime, shared — not copied — by every
 * runtime it is placed into), its instances' states, the pod's summary state, and what an instance offers.
 *
 *   instanceCoord('vault', 0)       // 'vault#0'
 *   parseInstance('vault#0')        // { pod: 'vault', index: 0 }
 *   podInfo(record)                 // { id: 'vault', implementation: 'acme/keys/vault', count: 1, state: 'running', home: 'r1', instances: [{ coord: 'vault#0', state: 'running' }] }
 *   portOp(record.implementation, port)   // the op behind a port key, or undefined
 */
import { portKey } from '../iface.ts'
import type { Implementation } from '../implementation.ts'
import type { Op } from '../op.ts'
import type { Pod } from '../pod.ts'
import type { Target } from '../selector.ts'
import type { RuntimeEvent } from './trace.ts'

/** Runtime, pod and subscription ids: the one rule the runtime, the application and the document share. */
export const ID = /^[^/\s#\x00-\x1f\x7f]{1,64}$/

export type InstanceState = 'starting' | 'running' | 'failed' | 'stopped'
export type PodState = InstanceState

/** One made implementation in a pod. `host` is its invoker (a host pod from `pod.ts`) while it is running. */
export type Instance = { readonly coord: string; state: InstanceState; host?: Pod; /** Why its make failed, while it is `failed`. */ reason?: string }

/** A runtime that holds a pod: it delivers the pod's publishes, refreshes its statuses and tells its stream when the pod changes. */
export type Holder = {
  deliver(from: string, port: string, data: unknown): Promise<void>
  refresh(): void
  /** News of the pod (its instances' states, a swap, a failure) for this runtime's stream. */
  emit(e: RuntimeEvent): void
  /** These coords of `pod` are gone (the whole pod if `whole`): drop the subscriptions naming them. */
  forget(pod: PodRecord, coords: string[], whole: boolean): void
}

/** `next` is the next instance index (indices are never reused); `holders` are the runtimes it is a member of. */
export type PodRecord = {
  readonly id: string
  implementation: Implementation
  config?: unknown
  readonly home: string
  next: number
  readonly instances: Map<string, Instance>
  readonly holders: Set<Holder>
}

export type PodInfo = {
  id: string
  implementation: string
  config?: unknown
  count: number
  state: PodState
  home: string
  instances: { coord: string; state: InstanceState; reason?: string }[]
}

export const instanceCoord = (pod: string, n: number): string => `${pod}#${n}`

/** Why these saved instance indices and `next` cannot be a pod's (up to 500 distinct whole numbers, each below `next`), or undefined. */
export function badIndices(instances: readonly number[], next: number): string | undefined {
  const whole = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max
  if (!whole(next, 1e9) || instances.length > 500 || new Set(instances).size !== instances.length || !instances.every(n => whole(n, next - 1)))
    return 'instances must be up to 500 distinct whole numbers, each below next (at most 1000000000)'
}

export function parseInstance(coord: string): { pod: string; index: number } | undefined {
  const m = /^(.*)#(0|[1-9][0-9]{0,8})$/.exec(coord)
  return m && ID.test(m[1]!) ? { pod: m[1]!, index: Number(m[2]) } : undefined
}

/** Starting if any instance is; else failed if any is; else stopped if every one is; else running. */
export function podState(states: InstanceState[]): PodState {
  for (const s of ['starting', 'failed'] as const) if (states.includes(s)) return s
  return states.every(s => s === 'stopped') ? 'stopped' : 'running'
}

export function podInfo(r: PodRecord): PodInfo {
  const instances = [...r.instances.values()].map(i => ({ coord: i.coord, state: i.state, ...(i.reason !== undefined && { reason: i.reason }) }))
  return {
    id: r.id, implementation: r.implementation.coord, ...(r.config !== undefined && { config: r.config }),
    count: instances.length, state: podState(instances.map(i => i.state)), home: r.home, instances,
  }
}

/** The pod and instance behind a coord, among these pods. */
export function locate(pods: ReadonlyMap<string, PodRecord>, coord: string): { pod: PodRecord; instance: Instance } | undefined {
  const p = parseInstance(coord)
  const pod = p && pods.get(p.pod)
  const instance = pod?.instances.get(coord)
  return instance && { pod: pod!, instance }
}

export function portOp(impl: Implementation, port: string): Op | undefined {
  for (const i of impl.provides) for (const o of i.byCoord.values()) if (portKey(i.coord, o.coord) === port) return o
  return undefined
}

export const targetOf = (coord: string, impl: Implementation, tags: ReadonlySet<string>): Target => ({
  instance: coord,
  implementation: impl.coord,
  provider: impl.provider,
  provides: new Set(impl.provides.map(i => i.coord)),
  tags,
})
