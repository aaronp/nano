/**
 * Provisioning, in one synchronous pass: for each dependency of a registered pod that no connection satisfies,
 * subscribe to the one matching pod here, or create a pod of the one matching implementation, register it, provision
 * it (same pass), and subscribe to it. Create first, then wire: a made pod is registered before its own dependencies
 * are settled, so mutual dependencies connect both ways. A starting pod is available, so nothing waits.
 *
 *   rt.provision('acme/cyc/a#0')     // success([]): acme/cyc/b#0 made; b → a and a → b subscribed
 *   provision(p, coord, impl)        // [] or [{ role: 'bar', reason: '2 match' }]
 */
import type { Implementation } from '../implementation.ts'
import type { Registry } from '../registry.ts'
import type { NanoResult } from '../result.ts'
import { matches, type SelectorData, type Target } from '../selector.ts'
import type { NewSubscription, Status, SubscriptionData } from './subscriptions.ts'

export type Unsatisfied = { role: string; reason: string }

/** What provisioning needs of a runtime. */
export type Provisioner = {
  registry: Registry
  /** Every registered pod's coord, whatever its state: a failed one still matches, and its subscription waits. */
  coords(): Iterable<string>
  target(coord: string): Target | undefined
  /** A live call subscription from `coord` (in any runtime its pod is in) already reaches a target matching `d`. */
  connected(coord: string, d: SelectorData): boolean
  /** Create a pod of `impl` and register it here: its coord. */
  make(impl: Implementation): NanoResult<string>
  subscribe(s: NewSubscription): NanoResult<SubscriptionData>
  status(id: string): Status | undefined
}

/** Implementations a selector names by interface, coord or provider. Tags can't be known before creation, so they never block; a selector naming none of the three matches none. */
export function implementationsFor(registry: Registry, d: SelectorData): Implementation[] {
  const pool =
    d.implements !== undefined ? registry.implementationsOf(d.implements)
    : d.implementation !== undefined ? [registry.implementation(d.implementation)]
    : d.provider !== undefined ? [...(registry.provider(d.provider)?.implementations.values() ?? [])]
    : []
  const { tags: _, ...named } = d
  return pool.filter((i): i is Implementation =>
    !!i && matches(named, { instance: '', implementation: i.coord, provider: i.provider, provides: new Set(i.provides.map(x => x.coord)), tags: new Set() }))
}

/** `coord` is already registered: a dependency that leads back to it finds it. */
export function provision(p: Provisioner, coord: string, impl: Implementation, depth = 0): Unsatisfied[] {
  const unsatisfied: Unsatisfied[] = []
  for (const [role, d] of Object.entries(impl.dependencies)) {
    if (p.connected(coord, d)) continue
    const leave = (reason: string) => { unsatisfied.push({ role, reason }) }
    const found = [...p.coords()].filter(c => { const t = c !== coord && p.target(c); return !!t && matches(d, t) })
    // Several pods: a choice for the user, not a reason to make yet another.
    if (found.length > 1) { leave(`${found.length} match`); continue }
    let to = found[0]
    if (!to) {
      const impls = implementationsFor(p.registry, d)
      if (impls.length !== 1) { leave(impls.length === 0 ? 'nothing matches' : `${impls.length} match`); continue }
      // ponytail: the manifest per make; a registry count if provisioning gets hot. A made pod matches later searches, so
      // this only trips when it cannot (a tag the made pod lacks), which would otherwise make pods forever.
      if (depth >= p.registry.manifest().implementations.length) { leave('provisioning too deep'); continue }
      const made = p.make(impls[0]!)
      if (!made.ok) { leave(made.fail.reason); continue }
      to = made.value
      provision(p, to, impls[0]!, depth + 1)
    }
    const s = p.subscribe({ kind: 'call', from: coord, to })
    if (!s.ok) leave(s.fail.reason)
    else if (p.status(s.value.id) !== 'live') leave(`subscription ${s.value.id} to ${to} is ${p.status(s.value.id)}`)
  }
  return unsatisfied
}
