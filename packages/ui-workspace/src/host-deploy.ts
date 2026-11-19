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

type Addition = { pods: Record<string, Pod>; runtimes: Record<string, RuntimeDeployment> }
type Removal = { runtimes: string[] }

const ns = Coord.namespace('workspace.host'), DEPLOY = ns.implementationId('deploy')
/** The `deploy` pod's data: built on its first call. */
export const deployPod: Pod = { implementation: DEPLOY.toString(), eager: false }
/** As long as the app's call timeout (its default): an unanswered ask must not hold the apply queue for good. */
const APPROVAL_MS = 30_000

/** `d` with `add`'s pods and runtimes. A new runtime may place pods already there (shared ones); a new pod or runtime
 * whose name is taken is invalid-input naming it, and nothing is added. Pure. */
export function addTo(d: AppDeployment, add: Addition): NanoResult<AppDeployment> {
  const taken = [...Object.keys(add.pods).filter(p => Object.hasOwn(d.pods, p)), ...Object.keys(add.runtimes).filter(r => Object.hasOwn(d.runtimes, r))]
  if (taken.length) return failure('invalid-input', `already in the deployment: ${taken.join(', ')}`)
  const out = structuredClone(d), more = structuredClone(add)
  return success({ ...out, pods: { ...out.pods, ...more.pods }, runtimes: { ...out.runtimes, ...more.runtimes } })
}

/** `d` without `rm`'s runtimes, nor the pods they placed that no other runtime places (nor those pods' edges, tags
 * and views). An unknown runtime is not-found. Pure. */
export function removeFrom(d: AppDeployment, rm: Removal): NanoResult<AppDeployment> {
  const missing = rm.runtimes.find(r => !Object.hasOwn(d.runtimes, r))
  if (missing !== undefined) return failure('not-found', `no runtime ${missing}`)
  const out = structuredClone(d)
  for (const r of rm.runtimes) delete out.runtimes[r]
  const still = new Set(Object.values(out.runtimes).flatMap(r => r.pods))
  const gone = new Set(rm.runtimes.flatMap(r => d.runtimes[r]!.pods).filter(p => !still.has(p)))
  for (const p of gone) { delete out.pods[p]; delete out.tags?.[p]; delete out.views?.[p] }
  for (const r of Object.values(out.runtimes)) r.subscriptions = r.subscriptions.filter(s => !gone.has(s.from) && !gone.has(s.to))
  return success(out)
}

/** "runtimes example-1..3" for a numbered run sharing a prefix, else the names listed. */
function runtimes(names: string[]): string {
  const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const m = sorted.map(n => /^(.*?)(\d+)$/.exec(n)), nums = m.map(x => Number(x?.[2]))
  const run = sorted.length > 1 && m.every(x => x && x[1] === m[0]![1]) && nums.every((n, i) => i === 0 || n === nums[i - 1]! + 1)
  return `runtime${sorted.length > 1 ? 's' : ''} ${run ? `${m[0]![1]}${nums[0]}..${nums.at(-1)}` : sorted.join(', ')}`
}

/** One line saying what going from `current` to `next` does, e.g. "Create runtimes example-1..3 (9 pods)". */
export function summary(current: AppDeployment, next: AppDeployment): string {
  const made = Object.keys(next.runtimes).filter(r => !Object.hasOwn(current.runtimes, r))
  const gone = Object.keys(current.runtimes).filter(r => !Object.hasOwn(next.runtimes, r))
  const pods = Object.keys(next.pods).filter(p => !Object.hasOwn(current.pods, p)).length
  return [
    ...(made.length ? [`Create ${runtimes(made)} (${pods} pod${pods === 1 ? '' : 's'})`] : []),
    ...(gone.length ? [`Remove ${runtimes(gone)}`] : []),
  ].join('; ') || 'Change the deployment'
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
