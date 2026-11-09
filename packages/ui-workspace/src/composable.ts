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
import { Components, Ops, Registries, Runtimes, type Op } from '@composable/core'
import { provide } from '@composable/elements'
import { catalog, Debounce, defineBundle, Input, Log, Map, Range } from '@composable/bundle'
import { definePlatform, platform, PlatformOps as P } from '@composable/platform'
import { defineElements as defineEditor } from '@composable/editor/elements'

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

defineBundle()
definePlatform()
defineEditor()
