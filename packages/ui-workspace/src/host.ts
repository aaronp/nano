/**
 * The host: the one `Application`, what is loaded (`Loaded`: the deployment with its providers and view selectors, the
 * registry, the default views), and import, apply and save over them. Its own pod is `ui` (HostUI) in runtime `main`,
 * and it is never saved. A failure is shown with `toast()` and changes nothing.
 *
 *   const host = (await start()).value
 *   await host.importUrl('/examples/slice/nano.json')   // importApp, then apply
 *   host.saved()                                         // { ...app.deployment(), providers, views }, without ui
 */
import { Application, assemble, createRegistry, Pod, success, type AppDeployment, type NanoResult, type Registry } from '@pritzlaff/nano-core'
import uiProvider, { importApp, views as uiViews, type Loaded, type ViewMap } from '@pritzlaff/nano-ui'
import { toast } from '@pritzlaff/nano-elements'
import { hostProvider, hostUi } from './host-ui.ts'

export type Host = {
  readonly app: Application
  readonly registry: Registry
  /** The live deployment with the providers and view selectors the host keeps. */
  data(): AppDeployment
  /** Implementation → its default view tag, from nano.ui and every loaded module. */
  defaults(): ViewMap
  apply(next: AppDeployment): Promise<NanoResult<void>>
  importUrl(url: string): Promise<NanoResult<void>>
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
  const created = await Application.create(runtimes.value, {})
  if (!created.ok) return created
  const app = created.value
  let loaded: Loaded = { deployment: first, registry, views: { ...uiViews } }

  const data = (): AppDeployment => ({ ...app.deployment(), providers: { ...loaded.deployment.providers }, views: { ...loaded.deployment.views } })
  async function apply(next: AppDeployment, views = loaded.views): Promise<NanoResult<void>> {
    // The providers and views are kept before the apply, so listeners of its `applied` event already read them from data().
    const before = loaded
    loaded = { deployment: next, registry, views }
    const applied = shown(await app.apply(next))
    loaded = applied.ok ? { ...loaded, deployment: { ...app.deployment(), providers: next.providers, views: next.views } } : before
    return applied
  }

  return success({
    app, registry, data, apply: next => apply(next),
    defaults: () => ({ ...loaded.views }),
    saved: () => withoutHost(data()),
    async importUrl(url) {
      // With the pod ui still in it, so merge refuses an app naming a pod ui before any provider is registered.
      const imported = shown(await importApp(url, { ...loaded, deployment: unplaced(data()) }))
      if (!imported.ok) return imported
      // ponytail: an apply that fails now leaves the new providers registered (a Registry has no remove); harmless, unused.
      return apply(placed(imported.value.deployment), imported.value.views)
    },
  })
}
