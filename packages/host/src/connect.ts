/**
 * `connect(d, registry, pods)`: each of `pods`' dependencies not already met by one of its call edges wired to the one
 * other placed pod matching it (a call edge in that pod's runtime, and, when its policy is `rules`, a rule letting the
 * pod in, as `AppDeployment.edit`'s `create` does). None or several: left unwired, and a note says so. Pure.
 *
 *   const { deployment, notes } = connect(d, registry, ['participant1'])   // + call participant1 → messaging
 *   notes                                                                  // ['connected participant1 → messaging (example.messaging.Messaging)']
 */
import { matches, type AppDeployment, type Registry, type SelectorData } from '@pritzlaff/nano-core'
import { targets } from '@pritzlaff/nano-outline'

const where = (d: AppDeployment, pod: string) => Object.keys(d.runtimes).find(r => d.runtimes[r]!.pods.includes(pod))

export function connect(d: AppDeployment, registry: Registry, pods: readonly string[]): { deployment: AppDeployment; notes: string[] } {
  const out: AppDeployment = structuredClone(d), notes: string[] = []
  const target = targets(out, registry)
  const meets = (s: SelectorData, name: string, runtime: string) => { const t = target(name, runtime); return !!t && matches(s, t) }
  for (const pod of pods) {
    const deps = registry.implementation(out.pods[pod]?.implementation ?? '')?.dependencies ?? {}
    for (const [role, s] of Object.entries(deps)) {
      const met = Object.entries(out.runtimes).some(([r, rt]) => rt.subscriptions.some(e => e.kind === 'call' && e.from === pod && meets(s, e.to, r)))
      if (met) continue
      const found = Object.keys(out.pods).filter(p => p !== pod && where(out, p) && meets(s, p, where(out, p)!))
      const what = s.implements ?? role
      if (found.length !== 1) { notes.push(`${pod} needs ${what}: ${found.length ? `${found.join(', ')} all provide it; wire one in Connections` : 'nothing provides it'}`); continue }
      const to = found[0]!, rt = out.runtimes[where(out, to)!]!
      rt.subscriptions.push({ kind: 'call', from: pod, to })
      if (rt.policy?.kind === 'rules') rt.policy.rules.unshift({ allow: ['call', 'subscribe'], from: pod, outside: !rt.pods.includes(pod), ...(s.implements && { toInterface: String(s.implements) }) })
      notes.push(`connected ${pod} → ${to} (${what})`)
    }
  }
  return { deployment: out, notes }
}
