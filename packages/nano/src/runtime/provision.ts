/**
 * Provisioning: settle a joined instance's unconnected dependencies — subscribe to the one matching member, or make the one matching implementation.
 *
 *   await rt.create('a', 'acme/cyc/a', { provision: true })   // a joins, b-1 is made and joins, then a → b-1 and b-1 → a
 *   await provision(p, 'acme/app/foo#f', foo)                  // [] or [{ role: 'bar', reason: '2 match' }]
 */
import type { Implementation } from '../implementation.ts'
import type { Registry } from '../registry.ts'
import type { NanoResult } from '../result.ts'
import { matches, type SelectorData, type Target } from '../selector.ts'
import type { NewSubscription, SubscriptionData } from './subscriptions.ts'

export type Unsatisfied = { role: string; reason: string }

/** What provisioning needs of a runtime. `make` creates, joins and provisions one instance in the same pass. */
export type Provisioner = {
  registry: Registry
  members(): readonly string[]
  target(coord: string): Target | undefined
  /** A live call subscription from the instance already reaches a member matching `d`. */
  connected(d: SelectorData): boolean
  idFree(id: string): boolean
  make(id: string, implementation: string): Promise<NanoResult<{ coord: string }>>
  subscribe(s: NewSubscription): NanoResult<SubscriptionData>
  /** A safety net that should never trip: making more would pass the pass's depth limit. */
  tooDeep: boolean
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

/** `coord` is already a member: a dependency that leads back to it finds it, so mutual dependencies connect both ways. */
export async function provision(p: Provisioner, coord: string, impl: Implementation): Promise<Unsatisfied[]> {
  const unsatisfied: Unsatisfied[] = []
  for (const [role, d] of Object.entries(impl.dependencies)) {
    if (p.connected(d)) continue
    const leave = (reason: string) => { unsatisfied.push({ role, reason }) }
    const members = p.members().filter(c => { const t = c !== coord && p.target(c); return !!t && matches(d, t) })
    // Several members: a choice for the user, not a reason to make yet another.
    if (members.length > 1) { leave(`${members.length} match`); continue }
    let to = members[0]
    if (!to) {
      const impls = implementationsFor(p.registry, d)
      if (impls.length !== 1) { leave(impls.length === 0 ? 'nothing matches' : `${impls.length} match`); continue }
      if (p.tooDeep) { leave('provisioning too deep'); continue }
      const made = await p.make(freeId(p, impls[0]!.coord), impls[0]!.coord)
      if (!made.ok) { leave(made.fail.reason); continue }
      to = made.value.coord
    }
    const s = p.subscribe({ kind: 'call', from: coord, to })
    if (!s.ok) leave(s.fail.reason)
  }
  return unsatisfied
}

/** `<last segment of the coord>-<first free n from 1>`. */
function freeId(p: Provisioner, implementation: string): string {
  const base = implementation.slice(implementation.lastIndexOf('/') + 1)
  let n = 1
  while (!p.idFree(`${base}-${n}`)) n++
  return `${base}-${n}`
}
