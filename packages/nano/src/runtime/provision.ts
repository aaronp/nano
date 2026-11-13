/**
 * Provisioning: give a new instance's unconnected dependencies the one matching member, or make the one matching implementation.
 *
 *   const r = await provision(p, 'acme/app/foo#f', foo, ['acme/app/foo'])
 *   r.unsatisfied   // [] once bar-1 (and its own baz-1) are made and subscribed; or [{ role: 'bar', reason: '2 match' }]
 *   r.cycle         // 'cycle: acme/cyc/a → acme/cyc/b → acme/cyc/a' when a dependency would close a cycle
 */
import type { Implementation } from '../implementation.ts'
import type { Registry } from '../registry.ts'
import type { NanoResult } from '../result.ts'
import { matches, type SelectorData, type Target } from '../selector.ts'
import type { NewSubscription, SubscriptionData } from './subscriptions.ts'

export type Unsatisfied = { role: string; reason: string }

/** What provisioning needs of a runtime. `make` creates (and provisions) one instance with the given creation stack. */
export type Provisioner = {
  registry: Registry
  members(): readonly string[]
  target(coord: string): Target | undefined
  /** A live call subscription from the new instance already reaches a member matching `d`. */
  connected(d: SelectorData): boolean
  idFree(id: string): boolean
  make(id: string, implementation: string, stack: readonly string[]): Promise<NanoResult<{ coord: string }>>
  subscribe(s: NewSubscription): NanoResult<SubscriptionData>
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

/** `stack` is the implementation coords being created, outermost first, ending with the new instance's own. */
export async function provision(p: Provisioner, coord: string, impl: Implementation, stack: readonly string[]): Promise<{ unsatisfied: Unsatisfied[]; cycle?: string; subscribed: string[] }> {
  const unsatisfied: Unsatisfied[] = []
  const subscribed: string[] = []
  let cycle: string | undefined
  for (const [role, d] of Object.entries(impl.dependencies)) {
    if (p.connected(d)) continue
    const leave = (reason: string) => { unsatisfied.push({ role, reason }) }
    const members = p.members().filter(c => { const t = p.target(c); return !!t && matches(d, t) })
    let to = members.length === 1 ? members[0]! : undefined
    // Several members: a choice for the user, not a reason to make yet another.
    if (members.length > 1) { leave(`${members.length} match`); continue }
    if (!to) {
      const impls = implementationsFor(p.registry, d)
      if (impls.length !== 1) { leave(impls.length === 0 ? 'nothing matches' : `${impls.length} match`); continue }
      const x = impls[0]!
      if (stack.includes(x.coord)) {
        cycle ??= `cycle: ${[...stack.slice(stack.indexOf(x.coord)), x.coord].join(' → ')}`
        leave(cycle)
        continue
      }
      const made = await p.make(freeId(p, x.coord), x.coord, stack)
      if (!made.ok) {
        if (made.fail.type === 'cycle') cycle ??= made.fail.reason
        leave(made.fail.reason)
        continue
      }
      to = made.value.coord
    }
    const s = p.subscribe({ kind: 'call', from: coord, to })
    if (s.ok) subscribed.push(s.value.id)
    else leave(s.fail.reason)
  }
  return { unsatisfied, subscribed, ...(cycle !== undefined && { cycle }) }
}

/** `<last segment of the coord>-<first free n from 1>`. */
function freeId(p: Provisioner, implementation: string): string {
  const base = implementation.slice(implementation.lastIndexOf('/') + 1)
  let n = 1
  while (!p.idFree(`${base}-${n}`)) n++
  return `${base}-${n}`
}
