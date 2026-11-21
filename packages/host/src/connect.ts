/**
 * A new pod's dependencies, each wired to the one other placed pod matching it (a call edge in that pod's runtime, and,
 * when its policy is `rules`, a rule letting the new pod in). None or several: left unwired. Pure. (host-react's
 * connect.ts and the workspace's auto-connect.ts do the same until they move onto the host core.)
 */
import { matches, type AppDeployment, type Registry } from '@pritzlaff/nano-core'
import { targets } from '@pritzlaff/nano-outline'

export function connect(d: AppDeployment, registry: Registry, pod: string): AppDeployment {
  const out = structuredClone(d), target = targets(out, registry)
  const where = (p: string) => Object.keys(out.runtimes).find(r => out.runtimes[r]!.pods.includes(p))
  for (const s of Object.values(registry.implementation(out.pods[pod]?.implementation ?? '')?.dependencies ?? {})) {
    const found = Object.keys(out.pods).filter(p => { const r = p !== pod && where(p), t = r && target(p, r); return !!t && matches(s, t) })
    if (found.length !== 1) continue
    const to = found[0]!, rt = out.runtimes[where(to)!]!
    rt.subscriptions.push({ kind: 'call', from: pod, to })
    if (rt.policy?.kind === 'rules') rt.policy.rules.unshift({ allow: ['call', 'subscribe'], from: pod, outside: !rt.pods.includes(pod), ...(s.implements && { toInterface: String(s.implements) }) })
  }
  return out
}
