import { lookup, type AppDeployment } from '@pritzlaff/nano-core'

/** The deployment's pods with each call-edge target before its callers (stable: otherwise the listed order; a cycle keeps its listed order). */
export function restartOrder(d: AppDeployment): string[] {
  const calls = lookup(d).callsFrom, out: string[] = [], seen = new Set<string>()
  const visit = (pod: string) => {
    if (seen.has(pod) || !(pod in d.pods)) return
    seen.add(pod)
    for (const { to } of calls.get(pod) ?? []) visit(to)
    out.push(pod)
  }
  Object.keys(d.pods).forEach(visit)
  return out
}
