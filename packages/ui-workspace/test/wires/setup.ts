// A real app on nano-core 0.4: nano.ui's pods, with r (input) → d (debounce) → l (log) piped and a map m unpiped, and a
// stand-in for the page's Host (its app, registry, deployment and apply).
import { Application, AppDeployment, Registry, Pod, port, type Interface, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider, { Debounce, debounce, input, Input, Log, log, map, MapIface } from '@pritzlaff/nano-ui'
import type { Host } from '../../src/host.ts'
import { wireId, snapshotOf, buildModel } from '../../src/wires/model.ts'

export const tick = () => new Promise(r => setTimeout(r, 0))
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

/** A jack's key: `instance port:dir`. */
export const k = (instance: string, i: Interface, op: string, dir: 'in' | 'out') => `${instance} ${port(i, (i.ops as Record<string, never>)[op]!)}:${dir}`
const pipe = (from: string, fi: Interface, fo: string, to: string, ti: Interface, to_: string) =>
  ({ kind: 'pipe' as const, from, source: port(fi, (fi.ops as Record<string, never>)[fo]!), to, target: port(ti, (ti.ops as Record<string, never>)[to_]!) })
export const p1 = pipe('r', Input, 'submit', 'd', Debounce, 'push'), p2 = pipe('d', Debounce, 'flushed', 'l', Log, 'log')

export const deployment = (): AppDeployment => ({
  pods: { r: Pod.eager(input), d: Pod.eager(debounce, { config: { quietMs: 0 } }), l: Pod.eager(log), m: Pod.eager(map, { config: { code: 'return x' } }) },
  runtimes: { main: { pods: ['r', 'd', 'l', 'm'], subscriptions: [p1, p2] } },
})
export const registry = () => { const r = Registry.create(); must(r.add(uiProvider)); return r }
export { Debounce, Input, Log, MapIface }

export async function setup() {
  const reg = registry()
  const app = must(await Application.create(must(AppDeployment.assemble(deployment(), reg))))
  const host = { app, registry: reg, data: () => app.deployment(), document: () => ({ app: app.deployment(), outline: { roots: [], pages: {} } }), apply: (n: AppDeployment) => app.apply(n) } as unknown as Host
  return { host, app, s1: { id: wireId('main', p1) }, s2: { id: wireId('main', p2) } }
}

/** Panels for r and l (front coordinates), and a Notes panel with no pod. */
export const panels = [
  { instance: 'r', rect: { x: 0, y: 0, w: 400, h: 300 }, tag: 'nano-input' },
  { instance: 'l', rect: { x: 400, y: 0, w: 400, h: 300 }, tag: 'nano-log' },
  { instance: null, rect: { x: 800, y: 0, w: 400, h: 300 }, tag: 'textarea' },
]
/** The model of a deployment, under the panels. */
export const model = (d: AppDeployment, kinds: Record<string, string> = {}, titles: Record<string, string> = {}) =>
  buildModel({ snapshot: snapshotOf(d, registry()), panels, W: 1200, H: 600, application: 'ui', kinds, titles })
