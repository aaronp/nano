/** Shared setup of the explorer tests: a slice, an opened application, a mounted <nano-explorer> and its helpers. */
import { html } from 'lit'
import { Type } from 'typebox'
import { Coord, Application, AppDeployment, Registry, Implementation, Op, Pod, port, provide, success, Schema, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider, { Debounce, debounce, defineViews, input, Input, Log, log, map, MapIface } from '../src/index.ts'

export const ns = Coord.namespace('acme')

export const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
export const Str = Schema.define(Type.String(), 'Str')
export const Store = ns.interface('Store', { save: Op.action(Str, Str) })
export const App = ns.interface('App', { save: Op.action(Str, Str) })
export const db = Implementation.define(ns.implementationId('db'), { provides: [Store], make: () => [provide(Store, { save: async s => success(s) })] })
export const api = Implementation.define(ns.implementationId('api'), { provides: [App], dependencies: { store: Store }, make: ctx => [provide(App, { save: async s => { const st = ctx.one(Store); return st.ok ? st.value.call.save(s) : st } })] })

export const slice: AppDeployment = {
  pods: {
    in: Pod.eager(input), wait: Pod.eager(debounce, { config: { quietMs: 10 } }),
    up: Pod.lazy(map, { config: { code: 'return x' } }), out: Pod.lazy(log),
  },
  runtimes: { main: { pods: ['in', 'wait', 'up', 'out'], subscriptions: [
    { kind: 'pipe', from: 'in', source: port(Input, Input.ops.submit), to: 'wait', target: port(Debounce, Debounce.ops.push) },
    { kind: 'pipe', from: 'wait', source: port(Debounce, Debounce.ops.flushed), to: 'up', target: port(MapIface, MapIface.ops.map) },
    { kind: 'pipe', from: 'up', source: port(MapIface, MapIface.ops.map), to: 'out', target: port(Log, Log.ops.log) },
  ] } },
}
export const open = async (d: AppDeployment) => {
  const registry = Registry.create()
  registry.add(uiProvider)
  registry.add(ns.provider([db, api]))
  return { app: must(await Application.create(must(AppDeployment.assemble(d, registry)), {})), registry }
}
export type El = HTMLElement & { target: unknown; icon: unknown; updateComplete: Promise<unknown> }
export const mount = async (target: unknown) => {
  const el = document.createElement('nano-explorer') as El
  el.target = target
  el.icon = (n: { kind?: string; data?: { status?: string } }) => n.kind === 'pod' ? html`<svg role="img" aria-label=${n.data!.status}></svg><svg role="img" aria-label="pod"></svg>` : undefined
  document.body.append(el)
  await el.updateComplete
  return el
}
export const tree = (el: El) => el.shadowRoot!.querySelector('nano-tree') as HTMLElement & { updateComplete: Promise<unknown>; shadowRoot: ShadowRoot }
export const settle = async (el: El) => { await el.updateComplete; await tree(el).updateComplete }
export const text = (el: El) => tree(el).shadowRoot.textContent ?? ''


export const pane = (el: El) => el.shadowRoot!.querySelector('.details')!
export const choose = async (el: El, label: string) => {
  const rts = (el.target as { app: { deployment(): AppDeployment } }).app.deployment().runtimes
  for (const r of Object.keys(rts)) for (const p of rts[r]!.pods) (tree(el) as unknown as { reveal(id: string, o: object): void }).reveal(`s:${r}:${p}:0`, { focus: false })
  await settle(el);
  ([...tree(el).shadowRoot.querySelectorAll('.line')].find(l => l.textContent?.includes(label)) as HTMLElement).click()
  await settle(el)
}
export const edge: AppDeployment = { pods: { api: Pod.lazy(api), db: Pod.lazy(db) }, runtimes: { r: { pods: ['api', 'db'], subscriptions: [{ kind: 'call', from: 'api', to: 'db' }] } } }

defineViews()
