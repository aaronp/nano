/**
 * The host: the one `Application`, what is loaded (`Loaded`: the deployment with its providers and view selectors, the
 * registry, the default views), and import, apply and save over them. Its own pod is `ui` (HostUI) in runtime `main`,
 * and it is never saved. A failure is shown with `toast()` and changes nothing.
 *
 *   const host = (await start()).value
 *   await host.importUrl('/examples/slice/nano.json')   // importApp, then apply
 *   host.saved()                                         // { ...app.deployment(), providers, views, layout }, without ui
 */
import { Application, assemble, createRegistry, Pod, success, type AppDeployment, type NanoResult, type Pod as PodData, type Registry } from '@pritzlaff/nano-core'
import uiProvider, { views as uiViews, type ViewMap } from '@pritzlaff/nano-ui'
import { toast } from '@pritzlaff/nano-elements'
import { foreignOrigin, importApp, isolated, remembered, type Loaded } from './import.ts'
import { confirmImports } from './import-confirm.ts'
import { probe } from './described.ts'
import { hostProvider, hostUi } from './host-ui.ts'
import { edgesFor } from './sandbox/edges.ts'
import { openFrame } from './sandbox/frames.ts'
import { framesOf } from './sandbox/sandboxed-view.ts'
import { standIn, type Frame } from './sandbox/stand-in.ts'

export type Host = {
  readonly app: Application
  readonly registry: Registry
  /** The live deployment with the providers, view selectors and dock layout the host keeps. */
  data(): AppDeployment
  /** Implementation → its default view tag, from nano.ui and every loaded module. */
  defaults(): ViewMap
  apply(next: AppDeployment): Promise<NanoResult<void>>
  importUrl(url: string): Promise<NanoResult<void>>
  /** Whether the provider `coord` is loaded from another origin than this page (so imported only once approved). */
  foreign(coord: string): boolean
  /** What Save writes: `data()` without the host pod `ui`, and without `main` once nothing else is in it. */
  saved(): AppDeployment
}

const HOST = 'ui', MAIN = 'main'

/** `d` with the host pod taken out of `main` (and `main` dropped once nothing else is in it), still among the pods. Pure. */
function unplaced(d: AppDeployment): AppDeployment {
  const out = structuredClone(d), main = out.runtimes[MAIN]
  if (main) {
    main.pods = main.pods.filter(p => p !== HOST)
    main.subscriptions = main.subscriptions.filter(s => s.from !== HOST && s.to !== HOST)
    if (!main.pods.length && !main.subscriptions.length) delete out.runtimes[MAIN]
  }
  return out
}

/** `d` without the host's own pod. Pure. */
function withoutHost(d: AppDeployment): AppDeployment {
  const out = unplaced(d)
  delete out.pods[HOST]
  delete out.tags?.[HOST]
  delete out.views?.[HOST]
  return out
}

/** `d` with the host pod, first in `main`. Pure. */
function placed(d: AppDeployment): AppDeployment {
  const main = d.runtimes[MAIN] ?? { pods: [], subscriptions: [] }
  return { ...d, pods: { [HOST]: Pod.eager(hostUi), ...d.pods }, runtimes: { ...d.runtimes, [MAIN]: { ...main, pods: [HOST, ...main.pods] } } }
}

/** nano.ui's URL as importApp stores a provider: its path on http(s), else whole (a file: page, in tests). Relative to
 * the page, so a host under a subpath (GitHub Pages at /nano/) finds it. */
const at = URL.parse('./bundle/nano-ui.js', globalThis.location?.href)
const nanoUi = at ? (/^https?:$/.test(at.protocol) ? at.pathname : at.href) : '/bundle/nano-ui.js'

const shown = <T>(r: NanoResult<T>): NanoResult<T> => {
  if (!r.ok) toast(r.fail.reason, { variant: 'bad' })
  return r
}

export async function start(): Promise<NanoResult<Host>> {
  // nano.ui is bundle/nano-ui.js under the page: through the import map, the module this file imports.
  const registry = createRegistry()
  for (const p of [uiProvider, hostProvider]) { const added = registry.add(p); if (!added.ok) return added }
  const first = placed({ pods: {}, runtimes: {}, providers: { 'nano.ui': nanoUi }, views: {} })
  const runtimes = assemble(first, registry)
  if (!runtimes.ok) return runtimes
  let loaded: Loaded = { deployment: first, registry, views: { ...uiViews } }
  // A non-host pod runs in a frame, from its provider's URL as kept in `providers`; its open frame is in `frames`.
  const frames = new Map<string, Frame>()
  let made: Application | undefined   // set once created; isolate runs only after (the first deployment has no non-host pod)
  const live = () => { if (!made) throw new Error('the host is not started'); return made }
  function isolate(name: string, pod: PodData) {
    const real = registry.implementation(pod.implementation), at = real && loaded.deployment.providers?.[real.provider]
    if (!real || !at) throw new Error(`${name}: no provider URL for ${pod.implementation}`)
    return isolated(standIn(real, {
      url: new URL(at, document.baseURI).href, edges: p => edgesFor(live().deployment(), registry, p), app: live,
      onApplied: fn => live().listen(e => { if (e.type === 'applied') fn() }), warn: reason => void toast(reason, { variant: 'warn' }),
      open(p) {
        const f = openFrame(pod.isolation === 'sandbox' ? 'sandbox' : 'isolated-sandbox')
        frames.set(p, f)
        return { ...f, dispose() { if (frames.get(p) === f) frames.delete(p); f.dispose() } }
      },
    }), pod.isolation, foreignOrigin(at), approve)
  }
  // HostUI.approve through the app, so it is on the stream like any call; anything but a yes is a no (a late yes too,
  // after the call's timeout). Remembered per title (provider and origin): one dialog at a time, a yes for good.
  const approve = remembered(async title => {
    const r = await (live().call(MAIN, HOST) as { approve(a: { title: string }): Promise<NanoResult<unknown>> }).approve({ title })
    return r.ok && r.value === true
  })
  const created = await Application.create(runtimes.value, { isolate })
  if (!created.ok) return created
  const app = made = created.value
  framesOf.set(app, frames)

  const kept = (d: AppDeployment) => ({ providers: { ...d.providers }, views: { ...d.views }, ...(d.layout && { layout: structuredClone(d.layout) }) })
  const data = (): AppDeployment => ({ ...app.deployment(), ...kept(loaded.deployment) })
  async function apply(next: AppDeployment, views = loaded.views): Promise<NanoResult<void>> {
    // The providers, views and layout are kept before the apply, so listeners of its `applied` event already read them from data().
    const before = loaded
    loaded = { deployment: next, registry, views }
    const applied = shown(await app.apply(next))
    loaded = applied.ok ? { ...loaded, deployment: { ...app.deployment(), ...kept(next) } } : before
    return applied
  }

  return success({
    app, registry, data, apply: next => apply(next),
    defaults: () => ({ ...loaded.views }),
    foreign: coord => !!foreignOrigin(loaded.deployment.providers?.[coord]),
    saved: () => withoutHost(data()),
    async importUrl(url) {
      // With the pod ui still in it, so merge refuses an app naming a pod ui before any provider is registered.
      const imported = shown(await importApp(url, { ...loaded, deployment: unplaced(data()) }, {
        load: u => import(u), probe: u => probe(u, () => openFrame('isolated-sandbox')), confirm: confirmImports, approve,
      }))
      if (!imported.ok) return imported
      // ponytail: an apply that fails now leaves the new providers registered (a Registry has no remove); harmless, unused.
      return apply(placed(imported.value.deployment), imported.value.views)
    },
  })
}
