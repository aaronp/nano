/**
 * The one line the approval dialog shows for a deployment change: what going from `current` to `next` does, with numbered
 * runs of names collapsed ("example-1..3-raft"). Pure; `approvalPolicy` (host-deploy.ts) asks with it.
 */
import type { AppDeployment } from '@pritzlaff/nano-core'

/** The items, each numbered run sharing the rest (its first number varying by one) collapsed: "example-1..3-raft". */
function collapsed(items: string[]): string[] {
  const groups = new Map<string, { n: number; s: string }[]>()
  for (const s of new Set(items)) {
    const m = /\d+/.exec(s), key = m ? `${s.slice(0, m.index)}\0${s.slice(m.index + m[0].length)}` : s
    groups.set(key, [...(groups.get(key) ?? []), { n: m ? Number(m[0]) : NaN, s }])
  }
  return [...groups].flatMap(([key, g]) => {
    g.sort((a, b) => a.n - b.n)
    const run = g.length > 1 && g.every((x, i) => i === 0 || x.n === g[i - 1]!.n + 1)
    return run ? [key.replace('\0', `${g[0]!.n}..${g.at(-1)!.n}`)] : g.map(x => x.s)
  })
}
const runtimes = (names: string[]) => `runtime${names.length > 1 ? 's' : ''} ${collapsed(names).join(', ')}`
const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`

/** One line saying truthfully what going from `current` to `next` does: runtimes replaced, created (with the new pods)
 * and removed, pods replaced or dropped, the existing pods the new or replaced runtimes now place, and every new subscription
 * there reaching an existing pod. E.g. "Create runtimes example-1..3 (9 pods); places messaging, clock". */
export function summary(current: AppDeployment, next: AppDeployment): string {
  const had = (r: string) => Object.hasOwn(current.runtimes, r), old = (p: string) => Object.hasOwn(current.pods, p)
  const made = Object.keys(next.runtimes).filter(r => !had(r))
  const swapped = Object.keys(next.runtimes).filter(r => had(r) && JSON.stringify(current.runtimes[r]) !== JSON.stringify(next.runtimes[r]))
  const gone = Object.keys(current.runtimes).filter(r => !Object.hasOwn(next.runtimes, r))
  const pods = Object.keys(next.pods).filter(p => !old(p)).length
  const drops = Object.keys(current.pods).filter(p => !Object.hasOwn(next.pods, p))
  const podsSwapped = Object.keys(next.pods).filter(p => old(p) && JSON.stringify(current.pods[p]) !== JSON.stringify(next.pods[p]))
  const before = (r: string) => current.runtimes[r] ?? { pods: [], subscriptions: [] }
  const touched = [...swapped, ...made]
  const places = touched.flatMap(r => next.runtimes[r]!.pods.filter(p => old(p) && !before(r).pods.includes(p)))
  const edges = touched.flatMap(r => next.runtimes[r]!.subscriptions
    .filter(s => (old(s.from) || old(s.to)) && !before(r).subscriptions.some(b => JSON.stringify(b) === JSON.stringify(s)))
    .map(s => `${s.from} → ${s.to}`))
  const parts = [
    ...(swapped.length ? [`replace ${runtimes(swapped)}`] : []),
    ...(podsSwapped.length ? [`replace pod${podsSwapped.length > 1 ? 's' : ''} ${collapsed(podsSwapped).join(', ')}`] : []),
    ...(made.length ? [`create ${runtimes(made)} (${plural(pods, 'pod')})`] : pods ? [`add ${plural(pods, 'pod')}`] : []),
    ...(places.length ? [`places ${collapsed(places).join(', ')}`] : []),
    ...(edges.length ? [collapsed(edges).join(', ')] : []),
    ...(gone.length ? [`remove ${runtimes(gone)}`] : []),
    ...(drops.length ? [`drops ${collapsed(drops).join(', ')}`] : []),
  ].join('; ') || 'change the deployment'
  return parts[0]!.toUpperCase() + parts.slice(1)
}
