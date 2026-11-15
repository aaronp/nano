/**
 * The explorer: application → runtimes → pods → edges, re-rendering on apply, drilling down through nano-open.
 */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Application, assemble, createRegistry, iface, implementation, op, Pod, port, provide, provider, success, defineSchema, type AppDeployment, type NanoResult } from '@pritzlaff/nano'
import uiProvider, { Debounce, debounce, defineViews, input, Input, Log, log, map, MapIface } from '../src/index.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const Str = defineSchema('Str', Type.String())
const Store = iface('acme.Store', { save: op.action('save', Str, Str) })
const App = iface('acme.App', { save: op.action('save', Str, Str) })
const db = implementation('acme/db', { provides: [Store], make: () => [provide(Store, { save: async s => success(s) })] })
const api = implementation('acme/api', { provides: [App], dependencies: { store: Store }, make: ctx => [provide(App, { save: async s => ctx.one(Store).call.save(s) })] })

const slice: AppDeployment = {
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
const open = async (d: AppDeployment) => {
  const registry = createRegistry()
  registry.add(uiProvider)
  registry.add(provider('acme', [db, api]))
  return { app: must(await Application.create(must(assemble(d, registry)), {})), registry }
}
type El = HTMLElement & { target: unknown; updateComplete: Promise<unknown> }
const mount = async (target: unknown) => {
  const el = document.createElement('nano-explorer') as El
  el.target = target
  document.body.append(el)
  await el.updateComplete
  return el
}
const tree = (el: El) => el.shadowRoot!.querySelector('nano-tree') as HTMLElement & { updateComplete: Promise<unknown>; shadowRoot: ShadowRoot }
const settle = async (el: El) => { await el.updateComplete; await tree(el).updateComplete }
const text = (el: El) => tree(el).shadowRoot.textContent ?? ''

defineViews()

describe('the explorer', () => {
  test('given the slice, then it lists runtime main with pods in, wait, up, out and their pipes', async () => {
    const el = await mount(await open(slice))
    await settle(el)
    const t = text(el)
    for (const s of ['main', 'in', 'wait', 'up', 'out', 'submit → wait.push', 'flushed → up.map', 'map → out.log']) expect(t).toContain(s)
  })

  test('given an edge api → db, when "built on → db" is chosen, then nano-open fires with { runtime, pod: "db" }', async () => {
    const d: AppDeployment = { pods: { api: Pod.lazy(api), db: Pod.lazy(db) }, runtimes: { r: { pods: ['api', 'db'], subscriptions: [{ kind: 'call', from: 'api', to: 'db' }] } } }
    const el = await mount(await open(d))
    await settle(el)
    const opened: unknown[] = []
    el.addEventListener('nano-open', e => opened.push((e as CustomEvent).detail))
    const row = [...tree(el).shadowRoot.querySelectorAll('.line')].find(l => l.textContent?.includes('built on → db')) as HTMLElement
    row.click()
    expect(opened).toEqual([{ runtime: 'r', pod: 'db' }])
  })

  test('given apply adds a pod, then the explorer shows it without being remounted', async () => {
    const o = await open(slice)
    const el = await mount(o)
    await settle(el)
    const d = o.app.deployment()
    must(await o.app.apply({ pods: { ...d.pods, extra: Pod.lazy(log) }, runtimes: { main: { ...d.runtimes.main!, pods: [...d.runtimes.main!.pods, 'extra'] } } }))
    await settle(el)
    expect(text(el)).toContain('extra')
  })
})
