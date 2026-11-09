// A real host: runtime, platform and the bundle's catalog, with range → debounce → log connected and a map unwired.
import { Components, Ops, Registries, Runtimes, type Op } from '@composable/core'
import { catalog, Debounce, Log, Range } from '@composable/bundle'
import { platform, PlatformOps as P } from '@composable/platform'

export const tick = () => new Promise(r => setTimeout(r, 0))

export async function setup() {
  const host = Runtimes.create(Registries.create('host'))
  host.registry.add('platform', Components.instantiate(platform(host, catalog)))
  const call = (op: Op, arg: unknown) => host.call({ registry: 'host', instance: 'test' }, 'platform', Ops.key(op), arg) as Promise<any>
  for (const [kind, name] of [['range', 'r'], ['debounce', 'd'], ['log', 'l'], ['map', 'm']]) await call(P.createComponent, { kind, name, system: 'host' })
  const s1 = (await call(P.connect, { system: 'host', source: 'r', op: Ops.key(Range.ops.value), listener: 'd', target: Ops.key(Debounce.ops.enqueue) })).value
  const s2 = (await call(P.connect, { system: 'host', source: 'd', op: Ops.key(Debounce.ops.flushed), listener: 'l', target: Ops.key(Log.ops.info) })).value
  return { host, call, s1, s2 }
}

/** Panels for r and l (front coordinates), and a Notes panel with no model. */
export const panels = [
  { instance: 'r', rect: { x: 0, y: 0, w: 400, h: 300 }, tag: 'c-range' },
  { instance: 'l', rect: { x: 400, y: 0, w: 400, h: 300 }, tag: 'c-log' },
  { instance: null, rect: { x: 800, y: 0, w: 400, h: 300 }, tag: 'textarea' },
]
