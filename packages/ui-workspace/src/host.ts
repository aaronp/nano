/**
 * The host: the one `Application`, what is loaded (`Loaded`: the deployment with its modules and view selectors, the
 * registry, the default views), and import, apply and save over them. Its own pods are `ui` (HostUI), `deploy` and `pages`
 * (HostDeploy, HostPages over `start(pages)`'s store: host-deploy.ts, host-pages.ts) in runtime `main`, never saved. A failure is shown with `toast()` and changes nothing.
 *
 *   const host = (await start()).value
 *   await host.importUrl('/examples/slice/nano.json')   // importApp, then apply
 *   host.saved()                                         // { ...app.deployment(), modules, views, layout }, without ui
 *   host.saved(true)                                     // the same, reconciled with the calls seen (host.calls())
 */
import { Application, AppDeployment, Registry, Pod, success, type NanoResult, type Pod as PodData } from '@pritzlaff/nano-core'
import uiProvider, { views as uiViews, type ViewMap } from '@pritzlaff/nano-ui'
import { toast } from '@pritzlaff/nano-elements'
import { foreignOrigin, importApp, type Loaded } from './import.ts'
import { isolated, remembered } from './import-gate.ts'
import { confirmImports } from './import-confirm.ts'
import { probe } from './described.ts'
import { hostUi } from './host-ui.ts'
import { approvalPolicy, deployPod, hostProvider, HOST_PODS } from './host-deploy.ts'
import { pagesPod } from './host-pages.ts'
import { edgesFor } from './sandbox/edges.ts'
import { openFrame } from './sandbox/frames.ts'
import { connected } from './auto-connect.ts'
import { framesOf } from './sandbox/sandboxed-view.ts'
import { standIn, type Frame } from './sandbox/stand-in.ts'
import { recording, type History } from './history.ts'
import { observeCalls, type OpCall } from './observed-calls.ts'

export type Host = {
  readonly app: Application; readonly registry: Registry
  readonly history: History   // the app recorded from creation, before any import; and Reset (history.ts)
  /** The live deployment with the modules, view selectors and dock layout the host keeps. */
  data(): AppDeployment
  /** Implementation → its default view tag, from nano.ui and every loaded module. */
  defaults(): ViewMap
  apply(next: AppDeployment): Promise<NanoResult<void>>
  /** `chosen`: the Import dialog's edit of the file; the dialog showed what comes from another origin, so its Import is
   * the consent and `confirmImports` is not asked. Without it (a `?src=` boot import) the import asks. */
  importUrl(url: string, chosen?: { edit(d: AppDeployment): AppDeployment }): Promise<NanoResult<void>>
  /** Whether the provider `coord` is loaded from another origin than this page (so imported only once approved). */
  foreign(coord: string): boolean
  /** What Save writes: `data()` without the host's own pods (`HOST_PODS`), and without `main` once nothing else is in it; with
   * `reconcile`, the call edges that gained a seen, undeclared op pair carry their `ops` (observed-calls.ts). */
  saved(reconcile?: boolean): AppDeployment
  /** The op-level calls declared and seen so far (one observer for the app's life). */
  calls(): OpCall[]
}

const [HOST, DEPLOY, PAGES] = HOST_PODS, MAIN = 'main'
/** `d` with `own` taken out of `main` (dropped once empty), still among the pods. Pure. (Import keeps `deploy`'s edges.) */
function unplaced(d: AppDeployment, own = [HOST]): AppDeployment {
  const out = structuredClone(d), main = out.runtimes[MAIN]
  if (main) {
    main.pods = main.pods.filter(p => !own.includes(p))
    main.subscriptions = main.subscriptions.filter(s => !own.includes(s.from) && !own.includes(s.to))
    if (!main.pods.length && !main.subscriptions.length) delete out.runtimes[MAIN]
  }
  return out
}

/** `d` without the host's own pods. Pure. */
function withoutHost(d: AppDeployment): AppDeployment {
  const out = unplaced(d, [...HOST_PODS]); for (const p of HOST_PODS) { delete out.pods[p]; delete out.tags?.[p]; delete out.views?.[p] }
  return out
}

/** `d` with the host pods first in `main` (`deploy` and `pages` unless there). Pure. */
function placed(d: AppDeployment): AppDeployment {
  const main = d.runtimes[MAIN] ?? { pods: [], subscriptions: [] }, more = [DEPLOY, PAGES].filter(p => !main.pods.includes(p))
  return { ...d, pods: { [HOST]: Pod.eager(hostUi), [DEPLOY]: deployPod, [PAGES]: pagesPod, ...d.pods }, runtimes: { ...d.runtimes, [MAIN]: { ...main, pods: [HOST, ...more, ...main.pods] } } }
}

/** nano.ui's URL as importApp stores a provider: its path on http(s), else whole (a file: page, in tests). Relative to
 * the page, so a host under a subpath (GitHub Pages at /nano/) finds it. */
const at = URL.parse('./bundle/nano-ui.js', globalThis.location?.href)
const nanoUi = at ? (/^https?:$/.test(at.protocol) ? at.pathname : at.href) : '/bundle/nano-ui.js'

const shown = <T>(r: NanoResult<T>): NanoResult<T> => {
  if (!r.ok) toast(r.fail.reason, { variant: 'bad' })
  return r
}

export async function start(pages?: Parameters<typeof hostProvider>[1]): Promise<NanoResult<Host>> {
  // nano.ui is bundle/nano-ui.js under the page: through the import map, the module this file imports.
  const registry = Registry.create()
  for (const p of [uiProvider, hostProvider(() => live(), pages)]) { const added = registry.add(p); if (!added.ok) return added }
  const first = placed({ pods: {}, runtimes: {}, modules: { "nano.ui": nanoUi }, views: {} })
  const runtimes = AppDeployment.assemble(first, registry)
  if (!runtimes.ok) return runtimes
  let loaded: Loaded = { deployment: first, registry, views: { ...uiViews } }
  // A non-host pod runs in a frame, from its provider's URL as kept in `modules`; its open frame is in `frames`.
  const frames = new Map<string, Frame>()
  let made: Application | undefined   // set once created; isolate runs only after (the first deployment has no non-host pod)
  const live = () => { if (!made) throw new Error('the host is not started'); return made }
  function isolate(name: string, pod: PodData) {
    const real = registry.implementation(pod.implementation), at = real && loaded.deployment.modules?.[real.provider]
    if (!real || !at) throw new Error(`${name}: no provider URL for ${pod.implementation}`)
    return isolated(standIn(real, {
      url: new URL(at, document.baseURI).href, edges: p => edgesFor(live().deployment(), registry, p), app: live, implementation: c => registry.implementation(c),
      onApplied: fn => live().listen(e => { if (e.type === 'applied') fn() }), warn: reason => void toast(reason, { variant: 'warn' }),
      open(p) {
        const page = pod.isolation === 'home-origin' ? loaded.deployment.frames?.[real.provider] : undefined
        if (pod.isolation === 'home-origin' && !page) throw new Error(`${name}: no frame page for ${real.provider} (home-origin needs frames.${real.provider})`)
        const f = page ? openFrame('home-origin', page) : openFrame(pod.isolation === 'sandbox' ? 'sandbox' : 'isolated-sandbox')
        frames.set(p, f)
        return { ...f, dispose() { if (frames.get(p) === f) frames.delete(p); f.dispose() } }
      },
    }), pod.isolation, foreignOrigin(at), approve)
  }
  // HostUI.approve through the app, so it is on the stream like any call; anything but a yes is a no (a late yes too,
  // after the call's timeout). Remembered per title (provider and origin): one dialog at a time, a yes for good.
  const ask = async (title: string) => {
    const r = await (live().call(MAIN, HOST) as { approve(a: { title: string }): Promise<NanoResult<unknown>> }).approve({ title })
    return r.ok && r.value === true
  }, approve = remembered(ask)
  // A pod's apply asks every time (not remembered). Shadow and replay apps take DeploymentPolicies.allowAll(): it was decided live.
  const created = await Application.create(runtimes.value, { isolate, deploymentPolicy: approvalPolicy(ask, () => live().deployment()) })
  if (!created.ok) return created
  const app = made = created.value
  framesOf.set(app, frames)
  const observed = observeCalls(app, registry)

  const kept = (d: AppDeployment) => ({ modules: { ...d.modules }, ...(d.frames && { frames: { ...d.frames } }), views: { ...d.views }, ...(d.layout && { layout: structuredClone(d.layout) }) })
  const data = (): AppDeployment => ({ ...app.deployment(), ...kept(loaded.deployment) })
  async function apply(next: AppDeployment, views = loaded.views): Promise<NanoResult<void>> {
    // The modules, views and layout are kept before the apply, so listeners of its `applied` event already read them from data().
    const before = loaded
    loaded = { deployment: next, registry, views }
    const applied = shown(await app.apply(next))
    loaded = applied.ok ? { ...loaded, deployment: { ...app.deployment(), ...kept(next) } } : before
    return applied
  }

  return success({
    app, registry, data, apply: next => apply(next), history: await recording(app),
    defaults: () => ({ ...loaded.views }),
    foreign: coord => !!foreignOrigin(loaded.deployment.modules?.[coord]),
    saved: reconcile => withoutHost(reconcile ? { ...observed.reconciled(), ...kept(loaded.deployment) } : data()),
    calls: () => observed.calls(),
    async importUrl(url, chosen) {
      // With the pod ui still in it, so merge refuses an app naming a pod ui before any provider is registered.
      const imported = shown(await importApp(url, { ...loaded, deployment: unplaced(data()) }, {
        load: u => import(u), probe: u => probe(u, () => openFrame('isolated-sandbox')), confirm: chosen ? async () => true : confirmImports, ...(chosen && { edit: chosen.edit }), approve, warn: t => toast(t, { variant: 'warn' }),
      }))
      if (!imported.ok) return imported
      // ponytail: an apply that fails now leaves the new providers registered (a Registry has no remove); harmless, unused.
      const next = placed(imported.value.deployment), before = data().pods
      return apply(connected(next, registry, Object.keys(next.pods).filter(p => !(p in before))), imported.value.views)
    },
  })
}
