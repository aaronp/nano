// DeployStrategy: the Component to instantiate for a kind in a mode, and a deploy that adds it, labels it and guards it.
import { Components, err, guard, isOk, ok, type Component, type Owner, type Registry, type Result, type Runtime, type Selectors } from '@pritzlaff/nano-core'
import type { CatalogEntry } from '@pritzlaff/nano-elements'
import { runtimeOf } from '@composable/platform'
import { openFrame } from './frames'
import { serialEntry } from './protocol'
import { standIn } from './stand-in'

export type Mode = 'host' | 'sandbox' | 'isolated-sandbox'
/** A catalog entry the app holds: the element's, with its trust, the modes it may be deployed in (the first is the default) and the package module it came from. */
export type AppEntry = CatalogEntry & { modes: Mode[]; trust: 'trusted' | 'sandboxed'; source?: { url: string } }
export type AppCatalog = Record<string, AppEntry>
export type DeployStrategy = (kind: string, mode: Mode) => Component

/** `host` is the entry's component; an iframe mode is a stand-in with the same id and ops. Throws for a mode the entry doesn't allow. */
export const deployStrategy = (catalog: AppCatalog, open: typeof openFrame = openFrame): DeployStrategy => (kind, mode) => {
  const e = catalog[kind]
  if (!e) throw new Error(`no component kind ${kind}`)
  if (!e.modes.includes(mode)) throw new Error(`${kind} can't be deployed as ${mode}`)
  if (mode === 'host') return e.component
  const url = e.source?.url
  if (!url) throw new Error(`${kind} has no package to load in a ${mode}`)
  return standIn(serialEntry(e), () => open({ url, kind, mode, render: !!e.tag }))
}

/** Adds `kind` as `id` to `registry` in `mode`, labelled `nano/deploy` and `nano/trust`; an iframe mode (or given `outward`)
 * is guarded too (`nano/guarded`), by default allowed no outward calls. */
export function deploy(runtime: Runtime, id: string, kind: string, mode: Mode,
  opts: { catalog: AppCatalog; open?: typeof openFrame; owner?: Owner; outward?: Selectors }): Result<void> {
  const registry = runtime.registry
  if (registry.get(id)) return err(`${id} already exists in ${registry.id}`)   // before instantiating: that opens the frame
  let component: Component
  try { component = deployStrategy(opts.catalog, opts.open)(kind, mode) } catch (e) { return err(e instanceof Error ? e.message : String(e)) }
  const added = registry.add(id, Components.instantiate(component), opts.owner)
  if (!isOk(added)) return added
  registry.label(id, { 'nano/deploy': mode, 'nano/trust': opts.catalog[kind]!.trust })
  if (mode !== 'host' || opts.outward) {
    const g = guard(runtime, id, { allow: [], ...opts.outward })   // deny-only stays deny-all plus the deny
    if (!isOk(g)) { registry.remove(id); return g }
    registry.label(id, { 'nano/guarded': 'true' })
  }
  return ok(undefined)
}

/** Deploys into whichever runtime owns `registry`: the host's, or a system the platform made. Any other registry is an error. */
export function deployIn(host: Runtime, catalog: AppCatalog, registry: Registry, id: string, kind: string, mode: Mode, owner?: Owner,
  open?: typeof openFrame): Result<void> {
  const rt = registry === host.registry ? host : runtimeOf(host.registry, registry.id)
  return rt?.registry === registry ? deploy(rt, id, kind, mode, { catalog, owner, open }) : err(`no runtime for registry ${registry.id}`)
}
