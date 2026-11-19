/** Shared setup of the pod-view tests: the nano.ui slice, an opened application and a mounted view. */
import { Application, AppDeployment, Registry, Pod, port, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider, { Debounce, debounce, defineViews, input, Input, Log, log, map, MapIface, type ViewTarget } from '../src/index.ts'

export const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
export const slice: AppDeployment = {
  pods: {
    in: Pod.eager(input), wait: Pod.eager(debounce, { config: { quietMs: 10 } }),
    up: Pod.lazy(map, { config: { code: 'return String(x).toUpperCase()' } }), out: Pod.lazy(log),
  },
  runtimes: { main: { pods: ['in', 'wait', 'up', 'out'], subscriptions: [
    { kind: 'pipe', from: 'in', source: port(Input, Input.ops.submit), to: 'wait', target: port(Debounce, Debounce.ops.push) },
    { kind: 'pipe', from: 'wait', source: port(Debounce, Debounce.ops.flushed), to: 'up', target: port(MapIface, MapIface.ops.map) },
    { kind: 'pipe', from: 'up', source: port(MapIface, MapIface.ops.map), to: 'out', target: port(Log, Log.ops.log) },
  ] } },
}
export const open = async () => {
  const registry = Registry.create()
  registry.add(uiProvider)
  return { app: must(await Application.create(must(AppDeployment.assemble(slice, registry)), {})), registry }
}
export const mount = async (tag: string, target: ViewTarget) => {
  const el = document.createElement(tag) as HTMLElement & { target: ViewTarget; updateComplete: Promise<unknown> }
  el.target = target
  document.body.append(el)
  await el.updateComplete
  return el
}
export const text = (el: Element) => el.shadowRoot?.textContent ?? ''

defineViews()
