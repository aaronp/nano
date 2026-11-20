/**
 * `workspace.host/deploy`: this host's HostDeploy, the pod `deploy` beside `ui` in `main`. It applies to the host's
 * `Application` as its own pod (`caller: 'deploy'`), and the host's deployment policy (`approvalPolicy`) asks the user.
 *
 *   registry.add(hostProvider(() => app, pages))                // ui, deploy, and pages (host-pages.ts) over the page store
 *   Application.create(runtimes, { deploymentPolicy: approvalPolicy(ask, () => app.deployment()) })
 *   addTo(d, { pods, runtimes })   // d with them; an existing pod or runtime name is invalid-input
 */
import { Coord, Implementation, failure, provide, success, type AppDeployment, type Application, type DeploymentPolicy, type NanoResult, type Pod, type RuntimeDeployment } from '@pritzlaff/nano-core'
import { HostDeploy } from '@pritzlaff/nano-ui'
import { summary } from './deploy-summary.ts'
import { hostUi } from './host-ui.ts'
import { hostPages } from './host-pages.ts'

type Addition = { pods: Record<string, Pod>; runtimes: Record<string, RuntimeDeployment>; onConflict?: 'error' | 'overwrite' }
type Removal = { runtimes: string[] }

const ns = Coord.namespace('workspace.host'), DEPLOY = ns.implementationId('deploy')
/** The host's own pods (`ui`, `deploy`, `pages`): no pod may overwrite them, nor overwrite or remove a runtime placing one. */
export const HOST_PODS: readonly [string, string, string] = ['ui', 'deploy', 'pages']
const hosting = (d: AppDeployment, r: string) => d.runtimes[r]!.pods.some(p => HOST_PODS.includes(p))
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

/** `d` with `add`'s pods and runtimes. A new runtime may place pods already there (shared ones), but not a host pod. A
 * pod or runtime whose name is taken is invalid-input naming it, nothing added; with `onConflict: 'overwrite'` it
 * replaces that one (a replaced runtime's pods placed nowhere else then are dropped), except a host pod or a runtime
 * placing one. Pure. */
export function addTo(d: AppDeployment, add: Addition): NanoResult<AppDeployment> {
  const taken = [...Object.keys(add.pods).filter(p => Object.hasOwn(d.pods, p)), ...Object.keys(add.runtimes).filter(r => Object.hasOwn(d.runtimes, r))]
  if (taken.length && add.onConflict !== 'overwrite') return failure('invalid-input', `already in the deployment: ${taken.join(', ')}`)
  const host = [...Object.keys(add.pods).filter(p => HOST_PODS.includes(p) && Object.hasOwn(d.pods, p)), ...Object.keys(add.runtimes).filter(r => Object.hasOwn(d.runtimes, r) && hosting(d, r))]
  if (host.length) return failure('invalid-input', `the host's own, not overwritten: ${host.join(', ')}`)
  const placed = [...new Set(Object.values(add.runtimes).flatMap(r => r.pods).filter(p => HOST_PODS.includes(p)))]
  if (placed.length) return failure('invalid-input', `the host's own, not placed by a pod: ${placed.join(', ')}`)
  const out = structuredClone(d), more = structuredClone(add)
  const was = Object.keys(more.runtimes).flatMap(r => Object.hasOwn(d.runtimes, r) ? d.runtimes[r]!.pods : [])
  return success(orphansDropped({ ...out, pods: { ...out.pods, ...more.pods }, runtimes: { ...out.runtimes, ...more.runtimes } }, was))
}

/** `d` without `rm`'s runtimes, nor the pods they placed that no other runtime places (nor those pods' edges, tags
 * and views). An unknown runtime is not-found. Pure. */
export function removeFrom(d: AppDeployment, rm: Removal): NanoResult<AppDeployment> {
  const missing = rm.runtimes.find(r => !Object.hasOwn(d.runtimes, r))
  if (missing !== undefined) return failure('not-found', `no runtime ${missing}`)
  const host = rm.runtimes.filter(r => hosting(d, r))
  if (host.length) return failure('invalid-input', `places the host's own pods, not removed: ${host.join(', ')}`)
  const out = structuredClone(d)
  for (const r of rm.runtimes) delete out.runtimes[r]
  return success(orphansDropped(out, rm.runtimes.flatMap(r => d.runtimes[r]!.pods)))
}

type Approve = (text: string) => Promise<boolean>
/** `approve`, where anything but a yes within `ms` (a throw, a no, no answer) is false. */
const timed = (approve: Approve, ms = APPROVAL_MS): Approve => async text => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), ms) })
  return (await Promise.race([approve(text).catch(() => false), late]).finally(() => clearTimeout(timer))) === true
}

/** The host's deployment policy: the host's own applies are allowed; a pod's asks `approve(summary)`, and anything but
 * a yes within `ms` (a throw, a no, no answer) refuses. `current` is the deployment the summary compares with. */
export function approvalPolicy(approve: Approve, current: () => AppDeployment, ms = APPROVAL_MS): DeploymentPolicy {
  const ask = timed(approve, ms)
  return { async isAllowed({ caller, deployment }) {
    if (caller === 'host') return { approved: true }
    const text = summary(current(), deployment)
    return await ask(text) ? { approved: true } : { approved: false, reason: `not approved: ${text}` }
  } }
}

/** The host's provider: `ui` (HostUI), `deploy` (HostDeploy, applying to `app()`) and `pages` (HostPages over `pages`,
 * asking through `app()`'s `ui`, no answer within 20 s a no; none in a replayed app). */
export function hostProvider(app: () => Application, pages?: Parameters<typeof hostPages>[0]) {
  const deploy = Implementation.define(DEPLOY, {
    provides: [HostDeploy],
    make: ctx => {
      // One call at a time: a second, while the first waits for approval, would be computed from the deployment without
      // the first and undo it, and its ask would start after the first's, past the caller's timeout.
      // ponytail: a host apply between the read and the apply is still overwritten; queue edits in the app if that matters.
      let busy = false
      const applied = async (next: () => NanoResult<AppDeployment>): Promise<NanoResult<null>> => {
        if (busy) return failure('invalid-input', 'a deployment is already waiting for approval')
        busy = true
        try {
          const d = next()
          if (!d.ok) return d
          const r = await app().apply(d.value, { caller: ctx.self })
          return r.ok ? success(null) : r
        } finally { busy = false }
      }
      return [provide(HostDeploy, {
        deploy: add => applied(() => addTo(app().deployment(), add as Addition)),
        undeploy: rm => applied(() => removeFrom(app().deployment(), rm)),
      })]
    },
  })
  const approve = timed(async title => {
    const r = await (app().call('main', HOST_PODS[0]) as { approve(a: { title: string }): Promise<NanoResult<unknown>> }).approve({ title })
    return r.ok && r.value === true
  })
  return ns.provider([hostUi, deploy, hostPages(pages, approve)])
}
