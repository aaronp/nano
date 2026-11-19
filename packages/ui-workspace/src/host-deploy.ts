/**
 * `workspace.host/deploy`: this host's HostDeploy, the pod `deploy` beside `ui` in `main`. It applies to the host's
 * `Application` as its own pod (`caller: 'deploy'`), and the host's deployment policy (`approvalPolicy`) asks the user.
 *
 *   registry.add(hostProvider(() => app))                       // ui and deploy
 *   Application.create(runtimes, { deploymentPolicy: approvalPolicy(ask, () => app.deployment()) })
 *   addTo(d, { pods, runtimes })   // d with them; an existing pod or runtime name is invalid-input
 */
import { Coord, Implementation, failure, provide, success, type AppDeployment, type Application, type DeploymentPolicy, type NanoResult, type Pod, type RuntimeDeployment } from '@pritzlaff/nano-core'
import { HostDeploy } from '@pritzlaff/nano-ui'
import { hostUi } from './host-ui.ts'

type Addition = { pods: Record<string, Pod>; runtimes: Record<string, RuntimeDeployment>; onConflict?: 'error' | 'overwrite' }
type Removal = { runtimes: string[] }

const ns = Coord.namespace('workspace.host'), DEPLOY = ns.implementationId('deploy')
/** The `deploy` pod's data: built on its first call. */
export const deployPod: Pod = { implementation: DEPLOY.toString(), eager: false }
/** Well under the app's call timeout (30 s): the pod's call into `deploy` started its timer before this apply was queued,
 * and time waiting in the apply queue counts against it too, so a late yes must not apply after the pod saw a timeout.
 * An unanswered ask must not hold the apply queue for good either. */
const APPROVAL_MS = 20_000

/** `out` without those of `was` (pods once placed) that no runtime places now, nor their edges, tags and views. */
function orphansDropped(out: AppDeployment, was: string[]): AppDeployment {
  const still = new Set(Object.values(out.runtimes).flatMap(r => r.pods)), gone = new Set(was.filter(p => !still.has(p)))
  for (const p of gone) { delete out.pods[p]; delete out.tags?.[p]; delete out.views?.[p] }
  for (const r of Object.values(out.runtimes)) r.subscriptions = r.subscriptions.filter(s => !gone.has(s.from) && !gone.has(s.to))
  return out
}

/** `d` with `add`'s pods and runtimes. A new runtime may place pods already there (shared ones). A pod or runtime whose
 * name is taken is invalid-input naming it, nothing added; with `onConflict: 'overwrite'` it replaces that one (a
 * replaced runtime's pods placed nowhere else then are dropped). Pure. */
export function addTo(d: AppDeployment, add: Addition): NanoResult<AppDeployment> {
  const taken = [...Object.keys(add.pods).filter(p => Object.hasOwn(d.pods, p)), ...Object.keys(add.runtimes).filter(r => Object.hasOwn(d.runtimes, r))]
  if (taken.length && add.onConflict !== 'overwrite') return failure('invalid-input', `already in the deployment: ${taken.join(', ')}`)
  const out = structuredClone(d), more = structuredClone(add)
  const was = Object.keys(more.runtimes).flatMap(r => Object.hasOwn(d.runtimes, r) ? d.runtimes[r]!.pods : [])
  return success(orphansDropped({ ...out, pods: { ...out.pods, ...more.pods }, runtimes: { ...out.runtimes, ...more.runtimes } }, was))
}

/** `d` without `rm`'s runtimes, nor the pods they placed that no other runtime places (nor those pods' edges, tags
 * and views). An unknown runtime is not-found. Pure. */
export function removeFrom(d: AppDeployment, rm: Removal): NanoResult<AppDeployment> {
  const missing = rm.runtimes.find(r => !Object.hasOwn(d.runtimes, r))
  if (missing !== undefined) return failure('not-found', `no runtime ${missing}`)
  const out = structuredClone(d)
  for (const r of rm.runtimes) delete out.runtimes[r]
  return success(orphansDropped(out, rm.runtimes.flatMap(r => d.runtimes[r]!.pods)))
}

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
 * and removed, pods replaced, the existing pods the new or replaced runtimes now place, and every new subscription
 * there reaching an existing pod. E.g. "Create runtimes example-1..3 (9 pods); places messaging, clock". */
export function summary(current: AppDeployment, next: AppDeployment): string {
  const had = (r: string) => Object.hasOwn(current.runtimes, r), old = (p: string) => Object.hasOwn(current.pods, p)
  const made = Object.keys(next.runtimes).filter(r => !had(r))
  const swapped = Object.keys(next.runtimes).filter(r => had(r) && JSON.stringify(current.runtimes[r]) !== JSON.stringify(next.runtimes[r]))
  const gone = Object.keys(current.runtimes).filter(r => !Object.hasOwn(next.runtimes, r))
  const pods = Object.keys(next.pods).filter(p => !old(p)).length
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
  ].join('; ') || 'change the deployment'
  return parts[0]!.toUpperCase() + parts.slice(1)
}

/** The host's deployment policy: the host's own applies are allowed; a pod's asks `approve(summary)`, and anything but
 * a yes within `ms` (a throw, a no, no answer) refuses. `current` is the deployment the summary compares with. */
export function approvalPolicy(approve: (text: string) => Promise<boolean>, current: () => AppDeployment, ms = APPROVAL_MS): DeploymentPolicy {
  return { async isAllowed({ caller, deployment }) {
    if (caller === 'host') return { approved: true }
    const text = summary(current(), deployment)
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), ms) })
    const yes = await Promise.race([approve(text).catch(() => false), late]).finally(() => clearTimeout(timer))
    return yes === true ? { approved: true } : { approved: false, reason: `not approved: ${text}` }
  } }
}

/** The host's provider: `ui` (HostUI) and `deploy` (HostDeploy, applying to `app()`). */
export function hostProvider(app: () => Application) {
  const deploy = Implementation.define(DEPLOY, {
    provides: [HostDeploy],
    make: ctx => {
      // ponytail: reads the deployment before its apply is queued, so a concurrent apply in between is overwritten; queue edits in the app if pods race.
      const applied = async (next: NanoResult<AppDeployment>): Promise<NanoResult<null>> => {
        if (!next.ok) return next
        const r = await app().apply(next.value, { caller: ctx.self })
        return r.ok ? success(null) : r
      }
      return [provide(HostDeploy, {
        deploy: add => applied(addTo(app().deployment(), add as Addition)),
        undeploy: rm => applied(removeFrom(app().deployment(), rm)),
      })]
    },
  })
  return ns.provider([hostUi, deploy])
}
