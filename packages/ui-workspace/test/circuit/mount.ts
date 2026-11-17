import { Ops } from '@pritzlaff/nano-core'
import { catalog, Debounce, Log, Range } from '@composable/bundle'
import { ApplicationOps as P, createApplication } from '@pritzlaff/nano-app'
import { defineCircuit, type Circuit } from '../src'

defineCircuit()
const tick = () => new Promise(r => setTimeout(r, 0))

// a host with r → d → l, a page /a showing r, d (tabbed behind r) and l, and a page /b showing l
export async function mount() {
  const { host } = createApplication({ catalogs: [catalog], placementsOf: (layout: any) => layout ?? [] })
  const call = (op: any, arg?: unknown) => host.call({ registry: 'host', instance: 'test' }, 'application', Ops.key(op), arg) as Promise<any>
  for (const [kind, name] of [['range', 'r'], ['debounce', 'd'], ['log', 'l'], ['map', 'm']]) await call(P.createComponent, { kind, name, system: 'host' })
  const rd = (await call(P.connect, { system: 'host', source: 'r', op: Ops.key(Range.ops.value), listener: 'd', target: Ops.key(Debounce.ops.enqueue) })).value
  await call(P.connect, { system: 'host', source: 'd', op: Ops.key(Debounce.ops.flushed), listener: 'l', target: Ops.key(Log.ops.info) })
  const tab = (instance: string, active: boolean) => ({ panel: instance, instance, box: { x: 0.05, y: 0.2, w: 0.4, h: 0.6 }, tab: { group: 'g', active } })
  await call(P.setScreen, { id: '/a', title: 'Alpha', system: 'host', layout: [tab('r', true), tab('d', false), { panel: 'l', instance: 'l', box: { x: 0.55, y: 0.2, w: 0.4, h: 0.6 } }] })
  await call(P.setScreen, { id: '/b', title: 'Beta', system: 'host', layout: [{ panel: 'l', instance: 'l' }] })
  const el = document.createElement('c-circuit') as Circuit
  el.runtime = host
  document.body.append(el)
  await tick(); await el.updateComplete
  const settle = async () => { await tick(); await tick(); await el.updateComplete }
  return { host, call, el, root: el.shadowRoot!, settle, rd }
}

