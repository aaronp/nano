/**
 * Boot: the stored app document's providers (nano.ui is this page's own; the rest same-origin modules, their `views`
 * kept), assembled into the one Application, and the Outline over the stored pages. Both documents are saved on each
 * `applied` and Outline change, unless another tab (the workspace, say) wrote them since: then this tab stops saving.
 *
 *   const h = await boot(localStorage)        // NanoResult<Host>
 */
import { Application, AppDeployment, failure, Registry, success, type NanoResult, type Provider } from '@pritzlaff/nano-core'
import uiProvider, { views as uiViews, type ViewMap } from '@pritzlaff/nano-ui'
import { Outline } from '@pritzlaff/nano-outline'
import { KEYS, readStored, writeStored } from './stored.ts'

export type Host = {
  app: Application; registry: Registry; outline: ReturnType<typeof Outline.create>; views: ViewMap
  /** The app document as saved: the live deployment with the stored modules, frames, views and layout. */
  saved(): AppDeployment
  /** Why saving stopped (another tab wrote, or storage refused), once it has. */
  stopped(): string | undefined
}
type Load = (url: string) => Promise<unknown>
const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Each provider `d.modules` names that `registry` lacks, loaded (same origin as `base` only); their views. */
async function providers(d: AppDeployment, registry: Registry, load: Load, base: string): Promise<NanoResult<ViewMap>> {
  const views: ViewMap = { ...uiViews }, home = new URL(base).origin
  for (const [coord, ref] of Object.entries(d.modules ?? {})) {
    if (registry.provider(coord)) continue
    const url = new URL(ref, base)
    if (url.origin !== home) return failure('invalid-input', `${coord}: ${url.origin} is another origin, not loaded by this host`)
    let mod: { default?: Provider; views?: ViewMap }
    try { mod = await load(url.href) as typeof mod } catch (e) { return failure('not-found', `${coord} (${ref}): ${why(e)}`) }
    if (!mod?.default) return failure('invalid-input', `${ref} has no default Provider`)
    const added = registry.add(mod.default)
    if (!added.ok) return added
    Object.assign(views, mod.views)
  }
  return success(views)
}

export async function boot(storage: Storage, load: Load = u => import(u), base = globalThis.location.href, onStop?: () => void): Promise<NanoResult<Host>> {
  const stored = readStored(storage), doc: AppDeployment = stored.app ?? { pods: {}, runtimes: {} }
  // An Application made with no runtimes has no registry, so it could never place a pod: start with an empty `main`.
  if (!Object.keys(doc.runtimes).length) doc.runtimes = { main: { pods: [], subscriptions: [] } }
  const pages = stored.pages === null ? success<Outline>({ roots: [], pages: {} }) : Outline.parse(stored.pages)
  if (!pages.ok) return pages
  const registry = Registry.create(), ui = registry.add(uiProvider)
  if (!ui.ok) return ui
  const views = await providers(doc, registry, load, base)
  if (!views.ok) return views
  const runtimes = AppDeployment.assemble(doc, registry)
  if (!runtimes.ok) return runtimes
  const created = await Application.create(runtimes.value)
  if (!created.ok) return created
  const app = created.value, outline = Outline.create(app, registry, pages.value)
  const { modules, frames, views: selectors, layout } = doc
  const saved = (): AppDeployment => ({ ...app.deployment(), ...(modules && { modules }), ...(frames && { frames }), ...(selectors && { views: selectors }), ...(layout !== undefined && { layout }) })
  let stopped: string | undefined
  const stop = (reason: string) => { stopped ??= reason; onStop?.() }
  const save = () => { if (stopped) return; const failed = writeStored(storage, saved(), outline.document().doc); if (failed) stop(`not saved: ${failed}`) }
  app.listen(e => { if (e.type === 'applied') save() })
  outline.listen(save)
  globalThis.addEventListener?.('storage', e => { const k = (e as StorageEvent).key; if (k === KEYS.app || k === KEYS.pages || k === KEYS.old) stop('changed in another tab: reload to continue') })
  return success({ app, registry, outline, views: views.value, saved, stopped: () => stopped })
}
