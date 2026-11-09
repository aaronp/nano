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
import type { Catalog } from '@pritzlaff/nano-elements'
import { definePlatform, platform, PlatformOps as P } from '@composable/platform'
import { defineElements as defineEditor } from '@composable/editor/elements'
import { defineWires } from '@composable/wires'

/** Every kind of component this host offers: its packages' catalogs, merged. Add a package, add its catalog. */
export const catalog: Catalog = { ...bundle, ...editor }

/** The page's runtime and its registry, `host`. */
export const host = Runtimes.create(Registries.create('host'))
provide(document, host.registry)
host.registry.add('platform', Components.instantiate(platform(host, catalog)))

const ask = async (op: Op, arg: unknown) => {
  const r = await host.call({ registry: 'host', instance: 'workspace' }, 'platform', Ops.key(op), arg)
  if ('error' in r) console.error('composable:', r.error)
}
for (const [kind, name] of [['range', 'ex-range'], ['debounce', 'ex-debounce'], ['log', 'ex-log'], ['input', 'ex-input'], ['map', 'ex-map']])
  await ask(P.createComponent, { kind, name, system: 'host' })
const wire = (source: string, op: Op, listener: string, target: Op) =>
  ask(P.connect, { system: 'host', source, op: Ops.key(op), listener, target: Ops.key(target) })
await wire('ex-range', Range.ops.value, 'ex-debounce', Debounce.ops.enqueue)
await wire('ex-debounce', Debounce.ops.flushed, 'ex-log', Log.ops.info)
await wire('ex-input', Input.ops.submitted, 'ex-map', Map.ops.map)
await wire('ex-map', Map.ops.mapped, 'ex-log', Log.ops.info)
const set = (id: string, op: Op, arg: unknown) => host.call({ registry: 'host', instance: 'workspace' }, id, Ops.key(op), arg)
await set('ex-map', Map.ops.setCode, 'return x * 2')
await set('ex-input', Input.ops.setKind, 'number')

// The dock can add every kind that has an element: a panel template each (marked as the catalog's, for the components
// drawer), before the hand-written ones.
const panel = document.querySelector('template[data-widget="c-platform"]')
for (const [kind, e] of Object.entries(catalog)) if (e.tag) {
  const t = Object.assign(document.createElement('template'), { innerHTML: `<${e.tag} keep></${e.tag}>` })   // closing a panel sends it to the rack
  t.dataset.widget = kind; t.dataset.title = e.title; t.dataset.catalog = ''
  panel?.before(t)
}

// The wiring view asks for a rack component back on the front: a panel of its kind, showing that instance.
document.addEventListener('wires:open-panel', e => {
  const { kind, name } = (e as CustomEvent<{ kind: string; name: string }>).detail
  const dock = (e.target as Element).querySelector?.('workspace-dock') ?? document.querySelector('workspace-dock')   // the dock the view tilts
  ;(dock as (Element & { addWidget?(id: string, name?: string): void }) | null)?.addWidget?.(kind, name)
})

defineBundle()
definePlatform()
defineEditor()
defineWires()
// the wiring view over the Workspace dock: it shows and edits the host system, and offers the merged catalog
for (const w of document.querySelectorAll('c-wires')) Object.assign(w, { runtime: host, catalog })
