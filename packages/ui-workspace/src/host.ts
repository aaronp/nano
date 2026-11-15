/**
 * The host: the one `Application`, what is loaded (`Loaded`: the deployment with its providers and view selectors, the
 * registry, the default views), and import, apply and save over them. Its own pod is `ui` (HostUI) in runtime `main`,
 * and it is never saved. A failure is shown with `toast()` and changes nothing.
 *
 *   const host = (await start()).value
 *   await host.importUrl('/examples/slice/nano.json')   // importApp, then apply
 *   host.saved()                                         // { ...app.deployment(), providers, views }, without ui
 */
import { Application, assemble, createRegistry, failure, Pod, success, type AppDeployment, type NanoResult, type Registry } from '@pritzlaff/nano'
import uiProvider, { views as uiViews, type ViewMap } from '@pritzlaff/nano-ui'
// ponytail: @pritzlaff/nano-ui does not export importApp/Loaded yet; read from its source until it does (bundled into main.js).
import { importApp, type Loaded } from '../../ui/src/import.ts'
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

/** `d` without the host's own pod. Pure. */
function withoutHost(d: AppDeployment): AppDeployment {
  const out = structuredClone(d)
  delete out.pods[HOST]
  delete out.tags?.[HOST]
  delete out.views?.[HOST]
  const main = out.runtimes[MAIN]
  if (main) {
    main.pods = main.pods.filter(p => p !== HOST)
    main.subscriptions = main.subscriptions.filter(s => s.from !== HOST && s.to !== HOST)
    if (!main.pods.length && !main.subscriptions.length) delete out.runtimes[MAIN]
  }
  return out
}

/** `d` with the host pod placed first in `main`; a pod of `d` named `ui` is a clash. Pure. */
function withHost(d: AppDeployment): NanoResult<AppDeployment> {
  if (HOST in d.pods) return failure('invalid-input', `clash: pod ${HOST} is already loaded`)
  const main = d.runtimes[MAIN] ?? { pods: [], subscriptions: [] }
  return success({ ...d, pods: { [HOST]: Pod.eager(hostUi), ...d.pods }, runtimes: { ...d.runtimes, [MAIN]: { ...main, pods: [HOST, ...main.pods] } } })
}

const shown = <T>(r: NanoResult<T>): NanoResult<T> => {
  if (!r.ok) toast(r.fail.reason, { variant: 'bad' })
  return r
}

export async function start(): Promise<NanoResult<Host>> {
  // nano.ui is /bundle/nano-ui.js: through the import map, the module this file imports.
  const registry = createRegistry()
  for (const p of [uiProvider, hostProvider]) { const added = registry.add(p); if (!added.ok) return added }
  const first = withHost({ pods: {}, runtimes: {}, providers: { 'nano.ui': '/bundle/nano-ui.js' }, views: {} })
  if (!first.ok) return first
  const runtimes = assemble(first.value, registry)
  if (!runtimes.ok) return runtimes
  const created = await Application.create(runtimes.value, {})
  if (!created.ok) return created
  const app = created.value
  let loaded: Loaded = { deployment: first.value, registry, views: { ...uiViews } }

  const data = (): AppDeployment => ({ ...app.deployment(), providers: { ...loaded.deployment.providers }, views: { ...loaded.deployment.views } })
  async function apply(next: AppDeployment, views = loaded.views): Promise<NanoResult<void>> {
    const applied = shown(await app.apply(next))
    if (applied.ok) loaded = { deployment: { ...app.deployment(), providers: next.providers, views: next.views }, registry, views }
    return applied
  }

  return success({
    app, registry, data, apply: next => apply(next),
    defaults: () => ({ ...loaded.views }),
    saved: () => withoutHost(data()),
    async importUrl(url) {
      const imported = shown(await importApp(url, { ...loaded, deployment: withoutHost(data()) }))
      if (!imported.ok) return imported
      const next = shown(withHost(imported.value.deployment))
      return next.ok ? apply(next.value, imported.value.views) : next
    },
  })
}
