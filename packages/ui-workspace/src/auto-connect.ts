/**
 * Auto-connect: a newly placed pod's dependencies, each wired to the one pod that matches it. Pure, over the data.
 *
 *   const { deployment, notes } = autoConnect(d, registry, ['participant1'])   // + call participant1 → messaging
 *
 * A dependency already met by one of the pod's call edges is left alone. Exactly one other pod matching its selector
 * gets a call edge, in that pod's runtime, and (as `AppDeployment.edit`'s `create` does) a rule letting it in when that
 * runtime's policy is `rules`. None, or several, change nothing and give a note naming them.
 */
import { matches, type AppDeployment, type Registry, type SelectorData } from '@pritzlaff/nano-core'
import { toast } from '@pritzlaff/nano-elements'
import { targets } from '@pritzlaff/nano-outline'

const where = (d: AppDeployment, pod: string) => Object.keys(d.runtimes).find(r => d.runtimes[r]!.pods.includes(pod))

export function autoConnect(d: AppDeployment, registry: Registry, pods: readonly string[]): { deployment: AppDeployment; notes: string[] } {
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
      const to = found[0]!, at = where(out, to)!, rt = out.runtimes[at]!
      rt.subscriptions.push({ kind: 'call', from: pod, to })
      if (rt.policy?.kind === 'rules') rt.policy.rules.unshift({ allow: ['call', 'subscribe'], from: pod, outside: !rt.pods.includes(pod), ...(s.implements && { toInterface: String(s.implements) }) })
      notes.push(`connected ${pod} → ${to} (${what})`)
    }
  }
  return { deployment: out, notes }
}

/** `autoConnect`, each note a toast: what was connected, and (a warning) what could not be. */
export function connected(d: AppDeployment, registry: Registry, pods: readonly string[]): AppDeployment {
  const r = autoConnect(d, registry, pods)
  for (const n of r.notes) void toast(n, { variant: n.startsWith('connected') ? 'good' : 'warn' })
  return r.deployment
}
