/**
 * The runtime: members and their lifecycle, subscriptions as data with live/waiting/broken status, policy on every rewire.
 *
 *   const rt = createRuntime('r1', { registry })
 *   await rt.create('b', 'acme/log/mem')                                  // NanoResult<{ coord: 'acme/log/mem#b', ... }>
 *   rt.subscribe({ kind: 'call', from: 'acme/app/main#a', to: 'acme/log/mem#b' }); rt.status('s1')   // 'live'
 */
import type { NanoContext } from '../context.ts'
import type { Implementation } from '../implementation.ts'
import { createHostPod, type Observation, type Pod } from '../pod.ts'
import { Policies, type Policy } from '../policy.ts'
import type { Registry } from '../registry.ts'
import { failure, success, type NanoResult } from '../result.ts'
import type { Target } from '../selector.ts'
import { instanceCoord, parseInstance, targetOf, type Member } from './members.ts'
import { nextId, reordered, statusOf, type NewSubscription, type Status, type SubscriptionData } from './subscriptions.ts'

export * from './members.ts'
export * from './subscriptions.ts'

export type RuntimeEvent =
  | { type: 'instance-added'; instance: string; home: string }
  | { type: 'instance-removed'; instance: string }
  | { type: 'instance-replaced'; from: string; to: string }
  | { type: 'subscription-set'; subscription: SubscriptionData }
  | { type: 'subscription-removed'; id: string }
  | { type: 'status'; id: string; status: Status }

export type Runtime = {
  readonly id: string
  readonly registry: Registry
  readonly policy: Policy
  create(id: string, implementation: string, opts?: { config?: unknown; provision?: boolean }): Promise<NanoResult<{ coord: string; unsatisfied: { role: string; reason: string }[] }>>
  add(m: Member): NanoResult<void>
  remove(coord: string): NanoResult<void>
  replace(coord: string, implementation: string, opts?: { config?: unknown }): Promise<NanoResult<string>>
  member(coord: string): Member | undefined
  members(): readonly string[]
  target(coord: string): Target | undefined
  subscribe(s: NewSubscription): NanoResult<SubscriptionData>
  unsubscribe(id: string): NanoResult<void>
  retarget(id: string, to: string): NanoResult<void>
  reorder(consumer: string, ids: string[]): NanoResult<void>
  subscriptions(): readonly SubscriptionData[]
  status(id: string): Status | undefined
  listen(fn: (e: RuntimeEvent) => void): () => void
}

export type RuntimeOpts = {
  registry: Registry
  policy?: Policy
  tagsOf?: (coord: string) => ReadonlySet<string>
  idTaken?: (id: string) => boolean
  pod?: { timeoutMs?: number; observe?(o: Observation): void }
}

export function createRuntime(id: string, opts: RuntimeOpts): Runtime {
  const { registry } = opts
  const policy = opts.policy ?? Policies.allowAll()
  const members = new Map<string, Member>()
  let subs: SubscriptionData[] = []
  const statuses = new Map<string, Status>()
  const listeners = new Set<(e: RuntimeEvent) => void>()

  const emit = (e: RuntimeEvent) => {
    for (const fn of listeners) try { fn(e) } catch { /* a listener must never break the runtime */ }
  }
  const recompute = () => {
    for (const s of subs) {
      const now = statusOf(s, c => members.get(c))
      if (statuses.get(s.id) !== now) { statuses.set(s.id, now); emit({ type: 'status', id: s.id, status: now }) }
    }
  }
  /** The first denial among these subscriptions, as a fail. */
  const denied = (list: readonly SubscriptionData[]): NanoResult<never> | undefined => {
    for (const s of list) {
      const v = policy.isAllowed(s.from, s.to, s)
      if (!v.approved) return failure('denied', v.reason)
    }
  }
  const idHeld = (iid: string, except?: string) =>
    [...members.keys()].some(c => c !== except && parseInstance(c)?.id === iid)

  async function makePod(coord: string, impl: Implementation, config: unknown): Promise<NanoResult<Pod>> {
    if (impl.config && !impl.config.check(config)) return failure('invalid-input', `${coord}: config does not fit ${impl.config.type}`)
    const ctx: NanoContext = { instance: coord, runtime: id, config }
    return createHostPod(coord, impl, ctx, opts.pod)
  }
  const drop = (m: Member) => {
    if (m.home === id) m.pod.dispose()
    members.delete(m.coord)
  }

  return {
    id,
    registry,
    policy,
    async create(iid, implementation, o = {}) {
      const impl = registry.implementation(implementation)
      if (!impl) return failure('not-found', `no implementation ${implementation}`)
      if (idHeld(iid) || opts.idTaken?.(iid)) return failure('exists', `instance id ${iid} is taken`)
      const coord = instanceCoord(implementation, iid)
      const pod = await makePod(coord, impl, o.config)
      if (!pod.ok) return pod
      // ponytail: re-check after the await; two concurrent creates of one id would otherwise both land.
      if (idHeld(iid)) { pod.value.dispose(); return failure('exists', `instance id ${iid} is taken`) }
      members.set(coord, { coord, pod: pod.value, home: id })
      emit({ type: 'instance-added', instance: coord, home: id })
      recompute()
      // Task 7 provisions; until then every declared dependency is unsatisfied.
      const unsatisfied = Object.keys(impl.dependencies).map(role => ({ role, reason: 'not provisioned' }))
      return success({ coord, unsatisfied })
    },
    add(m) {
      const parsed = parseInstance(m.coord)
      if (!parsed) return failure('invalid-input', `bad instance coord ${m.coord}`)
      if (members.has(m.coord) || idHeld(parsed.id)) return failure('exists', `instance id ${parsed.id} is taken`)
      members.set(m.coord, m)
      emit({ type: 'instance-added', instance: m.coord, home: m.home })
      recompute()
      return success(undefined)
    },
    remove(coord) {
      const m = members.get(coord)
      if (!m) return failure('not-found', `${coord} is not a member`)
      drop(m)
      emit({ type: 'instance-removed', instance: coord })
      recompute()
      return success(undefined)
    },
    async replace(coord, implementation, o = {}) {
      const old = members.get(coord)
      if (!old) return failure('not-found', `${coord} is not a member`)
      const impl = registry.implementation(implementation)
      if (!impl) return failure('not-found', `no implementation ${implementation}`)
      const to = instanceCoord(implementation, parseInstance(coord)!.id)
      const swap = (c: string) => (c === coord ? to : c)
      const touched = subs.filter(s => s.from === coord || s.to === coord).map(s => ({ ...s, from: swap(s.from), to: swap(s.to) }))
      const no = denied(touched)
      if (no) return no
      const pod = await makePod(to, impl, o.config)
      if (!pod.ok) return pod
      if (members.get(coord) !== old) { pod.value.dispose(); return failure('not-found', `${coord} changed while it was replaced`) }
      drop(old)
      members.set(to, { coord: to, pod: pod.value, home: id })
      subs = subs.map(s => touched.find(t => t.id === s.id) ?? s)
      emit({ type: 'instance-replaced', from: coord, to })
      for (const s of touched) emit({ type: 'subscription-set', subscription: s })
      recompute()
      return success(to)
    },
    member: c => members.get(c),
    members: () => [...members.keys()].sort(),
    target(coord) {
      const m = members.get(coord)
      return m && targetOf(m, opts.tagsOf?.(coord) ?? new Set())
    },
    subscribe(input) {
      const sid = input.id ?? nextId(subs)
      if (subs.some(s => s.id === sid)) return failure('exists', `subscription ${sid} exists`)
      const s = { ...input, id: sid } as SubscriptionData
      const no = denied([s])
      if (no) return no
      subs.push(s)
      emit({ type: 'subscription-set', subscription: s })
      recompute()
      return success(s)
    },
    unsubscribe(sid) {
      if (!subs.some(s => s.id === sid)) return failure('not-found', `no subscription ${sid}`)
      subs = subs.filter(s => s.id !== sid)
      statuses.delete(sid)
      emit({ type: 'subscription-removed', id: sid })
      return success(undefined)
    },
    retarget(sid, to) {
      const i = subs.findIndex(s => s.id === sid)
      if (i < 0) return failure('not-found', `no subscription ${sid}`)
      const s = { ...subs[i]!, to }
      const no = denied([s])
      if (no) return no
      subs[i] = s
      emit({ type: 'subscription-set', subscription: s })
      recompute()
      return success(undefined)
    },
    reorder(consumer, ids) {
      const next = reordered(subs, consumer, ids)
      if (!next) return failure('not-found', `${ids.join(', ')} is not exactly ${consumer}'s call subscriptions`)
      const no = denied(next.filter(s => ids.includes(s.id)))
      if (no) return no
      subs = next
      for (const sid of ids) emit({ type: 'subscription-set', subscription: subs.find(s => s.id === sid)! })
      return success(undefined)
    },
    subscriptions: () => [...subs],
    status: sid => statuses.get(sid),
    listen(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}
