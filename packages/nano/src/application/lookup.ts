/**
 * What a message needs to know about a deployment, found once per deployment object rather than scanned per message:
 * where each pod is placed, the call edges and pipes from each pod, and each runtime's compiled policy. `apply` makes a
 * new deployment object, so the cache follows it. It caches by object identity: treat `d` as immutable once looked up.
 *
 *   lookup(d).placed.get('backend')?.has('store')   // placed there?
 *   lookup(d).pipes.get(`${pod} ${port}`)            // the pipes carrying that emission, runtimes then subscriptions in order
 */
import type { AppDeployment } from '../deployment.ts'
import { Policies, PolicyRules, type Policy } from '../policy.ts'

type Pipe = { runtime: string; to: string; target: string }
export type Lookup = {
  /** Pods placed in each runtime. */
  placed: ReadonlyMap<string, ReadonlySet<string>>
  /** For each pod, the runtimes it is placed in, in order. */
  placedIn: ReadonlyMap<string, readonly string[]>
  /** For each pod, its call edges (wherever listed): runtimes in order, then subscriptions in order. */
  callsFrom: ReadonlyMap<string, readonly { runtime: string; to: string }[]>
  /** `${runtime} ${from} ${to}` for each call edge. */
  calls: ReadonlySet<string>
  /** For `${from} ${port}`, its pipes. */
  pipes: ReadonlyMap<string, readonly Pipe[]>
  /** Each runtime's policy from the deployment (`allow-all` when it has none). */
  policy(runtime: string): Policy
}

const cache = new WeakMap<AppDeployment, Lookup>()
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]) }

export function lookup(d: AppDeployment): Lookup {
  const hit = cache.get(d)
  if (hit) return hit
  const placed = new Map<string, Set<string>>(), placedIn = new Map<string, string[]>(), callsFrom = new Map<string, { runtime: string; to: string }[]>()
  const calls = new Set<string>(), pipes = new Map<string, Pipe[]>(), policies = new Map<string, Policy>()
  for (const [id, r] of Object.entries(d.runtimes)) {
    placed.set(id, new Set(r.pods))
    for (const p of r.pods) push(placedIn, p, id)
    for (const s of r.subscriptions) {
      if (s.kind === 'call') { calls.add(`${id} ${s.from} ${s.to}`); push(callsFrom, s.from, { runtime: id, to: s.to }) }
      else push(pipes, `${s.from} ${s.source}`, { runtime: id, to: s.to, target: s.target })
    }
    policies.set(id, r.policy?.kind === 'rules' ? PolicyRules(r.policy.rules) : Policies.allowAll())
  }
  const made: Lookup = { placed, placedIn, callsFrom, calls, pipes, policy: id => policies.get(id) ?? Policies.allowAll() }
  cache.set(d, made)
  return made
}
