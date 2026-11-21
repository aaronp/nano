/**
 * The workspace's host: the host core's (`Host.boot`, @pritzlaff/nano-host) with what only this host does. Its loader
 * is the gated one (`gatedLoad`: foreign code confirmed, probed and gated, ADR-0034), its pods `ui` (HostUI), `deploy`
 * and `outline` (host-deploy.ts, host-outline-pod.ts) first in `main` and never saved, each non-host pod run in a
 * frame (`isolate`) and a pod's apply approved (`approvalPolicy`). Over it: the history, the views, import and Save.
 * A failure is shown with `toast()` and changes nothing.
 *
 *   const host = (await start(localStorage, { migrate: oldForms })).value   // start(): in memory
 *   await host.importUrl('/examples/slice/nano.json')   // importApp, then the host core's apply, its views and layout in `host`
 *   host.saved(true)                                     // the HostDocument, its call edges reconciled with the calls seen
 */
import { AppDeployment, Pod, type NanoResult, type Pod as PodData } from '@pritzlaff/nano-core'
import { Host as Core, type HostDocument } from '@pritzlaff/nano-host'
import uiProvider, { views as uiViews, type ViewMap } from '@pritzlaff/nano-ui'
import { toast } from '@pritzlaff/nano-elements'
import { foreignOrigin, gatedLoad, importApp, type Deps } from './import.ts'
import { isolated, remembered } from './import-gate.ts'
import { confirmImports } from './import-confirm.ts'
import { probe } from './described.ts'
import { hostUi } from './host-ui.ts'
import { approvalPolicy, deployPod, hostProvider, HOST_PODS } from './host-deploy.ts'
import { outlinePod } from './host-outline-pod.ts'
import { edgesFor } from './sandbox/edges.ts'
import { openFrame } from './sandbox/frames.ts'
import { connected } from './auto-connect.ts'
import { framesOf } from './sandbox/sandboxed-view.ts'
import { standIn, type Frame } from './sandbox/stand-in.ts'
import { recording, type History } from './history.ts'
import { observeCalls, type OpCall } from './observed-calls.ts'

export type Host = Core & {
  readonly history: History   // the app recorded from boot; and Reset (history.ts)
  /** The live deployment (the host's own pods too) with where its code comes from (`modules`, nano.ui's always; `frames`). */
  data(): AppDeployment
  /** Implementation → its default view tag, from nano.ui and every loaded module. */
  defaults(): ViewMap
  /** `chosen`: the Import dialog's edit of the file; the dialog showed what comes from another origin, so its Import is
   * the consent and `confirmImports` is not asked. Without it (a `?src=` boot import) the import asks. */
  importUrl(url: string, chosen?: { edit(d: AppDeployment): AppDeployment }): Promise<NanoResult<void>>
  /** What Save writes: the host document; with `reconcile`, the call edges that gained a seen, undeclared op pair carry their `ops` (observed-calls.ts). */
  saved(reconcile?: boolean): HostDocument
  /** The op-level calls declared and seen so far (one observer for the app's life). */
  calls(): OpCall[]
}

const [HOST, DEPLOY, OUTLINE] = HOST_PODS, MAIN = 'main'
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
  const out = unplaced(d, [...HOST_PODS]); for (const p of HOST_PODS) { delete out.pods[p]; delete out.tags?.[p] }
  return out
}
const hostPods = { [HOST]: Pod.eager(hostUi), [DEPLOY]: deployPod, [OUTLINE]: outlinePod }
/** `d` with the host pods first in `main` (`deploy` and `outline` unless there). Pure. */
function placed(d: AppDeployment): AppDeployment {
  const main = d.runtimes[MAIN] ?? { pods: [], subscriptions: [] }, more = [DEPLOY, OUTLINE].filter(p => !main.pods.includes(p))
  return { ...d, pods: { ...hostPods, ...d.pods }, runtimes: { ...d.runtimes, [MAIN]: { ...main, pods: [HOST, ...more, ...main.pods] } } }
}

/** nano.ui's URL as importApp stores a provider: its path on http(s), else whole (a file: page, in tests). Relative to
 * the page, so a host under a subpath (GitHub Pages at /nano/) finds it. */
const at = URL.parse('./bundle/nano-ui.js', globalThis.location?.href)
const nanoUi = at ? (/^https?:$/.test(at.protocol) ? at.pathname : at.href) : '/bundle/nano-ui.js'
/** The workspace's part of `host.layout` (ADR-0039: keyed by client): the Desk's `desk`, the Ring filter's `ring`. */
export const workspaceLayout = (h: Core): Record<string, unknown> => { const w = h.document().host?.layout?.['workspace']; return typeof w === 'object' && w !== null ? w as Record<string, unknown> : {} }
const shown = <T>(r: NanoResult<T>): NanoResult<T> => { if (!r.ok) toast(r.fail.reason, { variant: 'bad' }); return r }

/** A Storage of this page's life only: the default, and where the workspace runs when the stored document did not load. */
const memory = (): Storage => {
  const m = new Map<string, string>()
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: k => void m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length() { return m.size } }
}

export async function start(storage: Storage = memory(), opts: Pick<Parameters<typeof Core.boot>[1], 'migrate' | 'onStop'> = {}): Promise<NanoResult<Host>> {
  let core: Core | undefined, booting: AppDeployment = { pods: {}, runtimes: {} }   // the stored app, until the core is up
  const live = () => { if (!core) throw new Error('the workspace has not started'); return core.app }
  const code = () => (core ? core.document().app : booting)
  const views: ViewMap = { ...uiViews }, frames = new Map<string, Frame>()
  // A non-host pod runs in a frame, from its provider's URL as kept in `modules`; its open frame is in `frames`. One
  // built while the core boots (an eager one stored) fails at once, and is built again once it is up (below).
  function isolate(name: string, pod: PodData) {
    const real = core?.registry.implementation(pod.implementation), at = real && code().modules?.[real.provider]
    if (!core) throw new Error(`${name} is built once the workspace has started`)
    if (!real || !at) throw new Error(`${name}: no provider URL for ${pod.implementation}`)
    return isolated(standIn(real, {
      url: new URL(at, document.baseURI).href, edges: p => edgesFor(live().deployment(), core!.registry, p), app: live, implementation: c => core!.registry.implementation(c),
      onApplied: fn => live().listen(e => { if (e.type === 'applied') fn() }), warn: reason => void toast(reason, { variant: 'warn' }),
      open(p) {
        const page = pod.isolation === 'home-origin' ? code().frames?.[real.provider] : undefined
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
  const deps = (confirm: Deps['confirm']): Deps => ({ load: u => import(u), probe: u => probe(u, () => openFrame('isolated-sandbox')), confirm, approve, warn: t => toast(t, { variant: 'warn' }) })
  const load = gatedLoad(deps(confirmImports))
  // A pod's apply asks every time (not remembered). Shadow and replay apps take DeploymentPolicies.allowAll(): it was decided live.
  const booted = await Core.boot(storage, { ...opts, base: globalThis.location.href, providers: [uiProvider, hostProvider(live, () => core?.outline)], hostPods,
    load: async (m, base, d) => { booting = d; const r = await load(m, base, d); if (r.ok) Object.assign(views, ...Object.values(r.value.exports).map(e => e['views'])); return r },
    create: { isolate, deploymentPolicy: approvalPolicy(ask, () => live().deployment()) } })
  if (!booted.ok) return booted
  const h = core = booted.value
  framesOf.set(h.app, frames)
  for (const [p, pod] of Object.entries(h.app.deployment().pods)) if (pod.eager && (pod.isolation ?? 'host') !== 'host') await h.app.restart(p)
  const observed = observeCalls(h.app, h.registry)
  const data = (): AppDeployment => { const { modules, frames } = h.document().app; return { ...h.app.deployment(), modules: { 'nano.ui': nanoUi, ...modules }, ...(frames && { frames }) } }
  const apply = async (next: AppDeployment) => shown(await h.apply(next))
  return { ok: true, value: {
    ...h, apply, data, history: await recording(h.app), defaults: () => ({ ...views }), calls: () => observed.calls(),
    saved: reconcile => { const doc = h.document(); return reconcile ? { ...doc, app: { ...withoutHost(observed.reconciled()), ...doc.app.modules && { modules: doc.app.modules }, ...doc.app.frames && { frames: doc.app.frames } } } : doc },
    async importUrl(url, chosen) {
      // With the pod ui still in it, so merge refuses an app naming a pod ui before any provider is registered.
      const was = h.document().host, imported = shown(await importApp(url, { deployment: { ...unplaced(data()), ...was }, registry: h.registry, views }, { ...deps(chosen ? async () => true : confirmImports), ...(chosen && { edit: chosen.edit }) }))
      if (!imported.ok) return imported
      // ponytail: an apply that fails now leaves the new providers registered (a Registry has no remove); harmless, unused.
      const { views: v, layout, ...next } = imported.value.deployment, before = data().pods
      Object.assign(views, imported.value.views)
      h.setHost({ views: v ?? {}, ...(layout && { layout }) })   // before the apply: its listeners read them
      const done = await apply(connected(placed(next), h.registry, Object.keys(next.pods).filter(p => !(p in before))))
      if (!done.ok) h.setHost({ views: was?.views ?? {}, layout: was?.layout ?? {} })
      return done
    },
  } }
}
