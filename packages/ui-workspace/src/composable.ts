/**
 * The adapter between this host and @composable components. Nothing else in the starter knows about them, and
 * they know nothing about the starter:
 *   - one runtime over the registry `host`, provided on the document, so elements in markup (or cloned into a
 *     dock panel) place their components there, and remove the ones they made when they go;
 *   - the platform as `platform`: it holds `host` and any systems made later, and builds from the bundle catalog;
 *   - a worked example, made through the platform so it outlives page changes: range → debounce → log, and
 *     input → map → log. The Systems page's elements name these instances and attach to them.
 * Imported before the elements are defined, so the registry is provided when markup upgrades.
 */
import { Components, Ops, Registries, Runtimes, type Op } from '@pritzlaff/nano-core'
import { provide } from '@pritzlaff/nano-elements'
import { catalog as bundle, Debounce, defineBundle, Input, Log, Map, Range } from '@composable/bundle'
import { catalog as editor } from '@composable/editor'
import { AppGateway, catalog as shell, defineShell, Profile } from '@composable/shell'
import type { Catalog } from '@pritzlaff/nano-elements'
import { definePlatform, definePlatformTable, platform, PlatformOps as P } from '@composable/platform'
import { defineElements as defineEditor } from '@composable/editor/elements'
import { defineWires } from '@composable/wires'
import { defineSandboxed, provideDeploy } from './sandbox/sandboxed-el.ts'
import { deploy, deployIn, type AppCatalog, type Mode } from './sandbox/deploy.ts'
import { HOST_ENTRIES } from './app/snapshot.ts'

/** Every kind of component this host offers: its packages' catalogs, merged. Add a package, add its catalog. */
export const catalog: AppCatalog = Object.fromEntries(Object.entries({ ...bundle, ...editor, ...shell } as Catalog).map(([k, e]) => [k, { ...e, modes: ['host'] as Mode[], trust: 'trusted' as const, ...(k === 'map' || k === 'filter' ? { code: ['setCode', 'configure'] } : {}) }]))

/** The page's runtime and its registry, `host`. */
export const host = Runtimes.create(Registries.create('host'))
provide(document, host.registry)
host.registry.add('app', Components.instantiate(AppGateway), { kind: 'app', name: 'ui-workspace' })   // focus and the app bar: in every system (a gateway), never written
host.registry.add('platform', Components.instantiate(platform(host, catalog, {
  gateways: ['app'], locked: id => id.startsWith('ws-controls-'),
  deploy: (system, id, kind, mode, owner, outward) => deploy(system, id, kind, (mode ?? 'host') as Mode, { catalog, owner, ...(outward && { outward }) }),
})), { kind: 'app', name: 'ui-workspace' })
// <c-sandboxed> creates its instance in the registry it shows (a dock's system, or the page's) through the same deploy
provideDeploy(document, (registry, id, kind, mode, owner) =>
  deployIn(host, catalog, registry, id, kind, mode as Mode, owner))

const ask = async (op: Op, arg: unknown) => {
  const r = await host.call({ registry: 'host', instance: 'workspace' }, 'platform', Ops.key(op), arg)
  if ('error' in r) console.error('composable:', r.error)
}
for (const [kind, name] of [['range', 'ex-range'], ['debounce', 'ex-debounce'], ['log', 'ex-log'], ['input', 'ex-input'], ['map', 'ex-map']])
  await ask(P.createComponent, { kind, name, system: 'host' })
await ask(P.createComponent, { kind: 'profile', name: 'profile', system: 'host' })
const wire = (source: string, op: Op, listener: string, target: Op) =>
  ask(P.connect, { system: 'host', source, op: Ops.key(op), listener, target: Ops.key(target) })
await wire('ex-range', Range.ops.value, 'ex-debounce', Debounce.ops.enqueue)
await wire('ex-debounce', Debounce.ops.flushed, 'ex-log', Log.ops.info)
await wire('ex-input', Input.ops.submitted, 'ex-map', Map.ops.map)
await wire('ex-map', Map.ops.mapped, 'ex-log', Log.ops.info)
const set = (id: string, op: Op, arg: unknown) => host.call({ registry: 'host', instance: 'workspace' }, id, Ops.key(op), arg)
await set('ex-map', Map.ops.setCode, 'return x * 2')
await set('ex-input', Input.ops.setKind, 'number')
await set('profile', Profile.ops.setUser, { name: 'You' })
await set('profile', Profile.ops.setEntries, HOST_ENTRIES)

// The dock can add every kind that has an element: a panel template each (marked as the catalog's, for the components
// drawer), before the hand-written ones.
/** A panel template for a kind: its element, kept when the panel closes (closing sends it to the rack). */
const templateFor = (kind: string, e: { title: string; tag?: string }, trust: 'trusted' | 'sandboxed' = 'trusted') => {
  // a sandboxed kind has no element in the host: <c-sandboxed> deploys it in its frame
  const html = trust === 'sandboxed' ? `<c-sandboxed keep kind="${kind}" mode="isolated-sandbox"></c-sandboxed>` : `<${e.tag} keep></${e.tag}>`
  const t = Object.assign(document.createElement('template'), { innerHTML: html })
  t.dataset.widget = kind; t.dataset.title = e.title; t.dataset.catalog = ''
  return t
}
const panel = document.querySelector('template[data-widget="c-platform"]')
for (const [kind, e] of Object.entries(catalog)) if (e.tag) panel?.before(templateFor(kind, e))

/** The kinds (and the page's own widget ids), component ids and element tags the host has loaded: an import must not
 * clash with them. */
export function loadedNames() {
  const es = Object.entries(catalog)
  const widgets = [...document.querySelectorAll<HTMLTemplateElement>('workspace-dock > template[data-widget]')].map(t => t.dataset.widget!)
  return { kinds: [...new Set([...es.map(([k]) => k), ...widgets])], ids: es.map(([, e]) => `${e.component.id.ns}/${e.component.id.name}`), tags: es.flatMap(([, e]) => (e.tag ? [e.tag] : [])) }
}

/** Adds an imported package's catalog to the running host: the platform can make its kinds (it holds this catalog),
 * every dock gets a panel template per kind with an element, and drawers hear `catalog:changed`. */
export function addCatalog(entries: Catalog, from: { name: string; url: string; module?: string }, trust: 'trusted' | 'sandboxed' = 'trusted') {
    for (const [kind, e] of Object.entries(entries)) catalog[kind] = { ...e, trust, modes: trust === 'trusted' ? ['host', 'sandbox', 'isolated-sandbox'] : ['isolated-sandbox'], source: { url: from.module ?? from.url } }
  for (const [kind, e] of Object.entries(entries)) if (e.tag) for (const dock of document.querySelectorAll<HTMLElement & { addTemplate?(t: HTMLTemplateElement): void }>('workspace-dock')) {
    const t = templateFor(kind, e, trust)
    t.dataset.package = from.name; t.dataset.packageUrl = from.url
    if (dock.addTemplate) dock.addTemplate(t); else dock.append(t)   // not defined yet: read when it connects
  }
  void ask(P.catalogChanged, null)   // views of the platform hear the new kinds
  document.dispatchEvent(new CustomEvent('catalog:changed', { detail: from }))
}

// The wiring view asks for a rack component back on the front: a panel of its kind, showing that instance.
document.addEventListener('wires:open-panel', e => {
  const { kind, name } = (e as CustomEvent<{ kind: string; name: string }>).detail
  const dock = (e.target as Element).querySelector?.('workspace-dock') ?? document.querySelector('workspace-dock')   // the dock the view tilts
  ;(dock as (Element & { addWidget?(id: string, name?: string): void }) | null)?.addWidget?.(kind, name)
})

defineBundle()
definePlatform(); definePlatformTable(); defineSandboxed()
defineEditor()
defineShell()
defineWires()
// the wiring view over the Workspace dock: it shows and edits the host system, and offers the merged catalog
for (const w of document.querySelectorAll('c-wires')) Object.assign(w, { runtime: host, catalog })
