/**
 * The explorer: application → runtimes → pods → edges, re-rendering on apply, drilling down through nano-open.
 */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Coord, Application, AppDeployment, Registry, Implementation, Op, Pod, port, provide, success, Schema, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider, { Debounce, debounce, defineViews, input, Input, Log, log, map, MapIface } from '../src/index.ts'

const ns = Coord.namespace('acme')

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const Str = Schema.define(Type.String(), 'Str')
const Store = ns.interface('Store', { save: Op.action(Str, Str) })
const App = ns.interface('App', { save: Op.action(Str, Str) })
const db = Implementation.define(ns.implementationId('db'), { provides: [Store], make: () => [provide(Store, { save: async s => success(s) })] })
const api = Implementation.define(ns.implementationId('api'), { provides: [App], dependencies: { store: Store }, make: ctx => [provide(App, { save: async s => { const st = ctx.one(Store); return st.ok ? st.value.call.save(s) : st } })] })

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
  const registry = Registry.create()
  registry.add(uiProvider)
  registry.add(ns.provider([db, api]))
  return { app: must(await Application.create(must(AppDeployment.assemble(d, registry)), {})), registry }
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
    for (const s of ['main', 'in', 'wait', 'up', 'out']) expect(t).toContain(s)
    const under = (pod: string) => tree(el).shadowRoot.querySelector(`li[data-id="p:main:${pod}"]`)!.textContent!
    expect(under('in')).toContain('submit → wait.push')
    expect(under('wait')).toContain('flushed → up.map')
    expect(under('up')).toContain('map → out.log')
    expect(under('out')).not.toContain('→')
  })

  const pane = (el: El) => el.shadowRoot!.querySelector('.details')!
  const choose = async (el: El, label: string) => {
    ([...tree(el).shadowRoot.querySelectorAll('.line')].find(l => l.textContent?.includes(label)) as HTMLElement).click()
    await settle(el)
  }
  const edge: AppDeployment = { pods: { api: Pod.lazy(api), db: Pod.lazy(db) }, runtimes: { r: { pods: ['api', 'db'], subscriptions: [{ kind: 'call', from: 'api', to: 'db' }] } } }

  test('choosing a pod shows its details and opens nothing; its Open view fires nano-open with { runtime, pod }', async () => {
    const el = await mount(await open(edge))
    await settle(el)
    const opened: unknown[] = []
    el.addEventListener('nano-open', e => opened.push((e as CustomEvent).detail))
    await choose(el, 'api')
    expect(opened).toEqual([])
    const t = pane(el).textContent!
    for (const s of ['pod api', 'acme/api', 'host', 'lazy', 'store (acme.Store) → db']) expect(t).toContain(s)
    ;(pane(el).querySelector('button') as HTMLButtonElement).click()
    expect(opened).toEqual([{ runtime: 'r', pod: 'api' }])
  })

  test('an unconnected need is flagged; "built on → db" shows the call edge, with Open db', async () => {
    const el = await mount(await open({ ...edge, runtimes: { r: { pods: ['api', 'db'], subscriptions: [] } } }))
    await settle(el)
    await choose(el, 'api')
    expect(pane(el).querySelector('.warn')?.textContent).toBe('not connected')
    const el2 = await mount(await open(edge))
    await settle(el2)
    await choose(el2, 'built on → db')
    expect(pane(el2).textContent).toContain('call edge')
    const opened: unknown[] = []
    el2.addEventListener('nano-open', e => opened.push((e as CustomEvent).detail))
    ;(pane(el2).querySelector('button') as HTMLButtonElement).click()
    expect(opened).toEqual([{ runtime: 'r', pod: 'db' }])
  })

  test('interfaces and implementations are listed; choosing one shows its ops or what it provides and needs, with links', async () => {
    const el = await mount(await open(edge))
    await settle(el)
    await choose(el, 'acme.Store')
    expect(pane(el).textContent!.replace(/\s+/g, ' ')).toContain('save action Str → Str')
    expect(pane(el).textContent).toContain('acme/db')
    await choose(el, 'acme/api')
    expect(pane(el).textContent).toContain('implementation acme/api')
    ;([...pane(el).querySelectorAll('a')].find(a => a.textContent === 'acme.Store') as HTMLElement).click()   // a link selects
    await settle(el)
    expect(pane(el).textContent).toContain('interface acme.Store')
  })

  test('a pipe shows its source and target as links to their interfaces, with what one emits and the other takes', async () => {
    const el = await mount(await open(slice))
    await settle(el)
    await choose(el, 'submit → wait.push')
    const t = pane(el).textContent!.replace(/\s+/g, ' ')
    expect(t).toContain('nano.ui.Input/submit action, emits Any')
    expect(t).toContain('nano.ui.Debounce/push action, takes Any')
    ;([...pane(el).querySelectorAll('a')].find(a => a.textContent === 'nano.ui.Debounce') as HTMLElement).click()
    await settle(el)
    expect(pane(el).textContent).toContain('interface nano.ui.Debounce')
  })

  test('typeName: a label, else a short shape', async () => {
    const { typeName } = await import('../src/explorer-details.ts')
    expect(typeName(Str as never)).toBe('Str')
    expect(typeName({ type: 'object', properties: { a: 1, b: 1 } })).toBe('{ a, b }')
    expect(typeName({ type: 'array', items: { type: 'string' } })).toBe('string[]')
    expect(typeName({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toBe('string | null')
    expect(typeName(undefined)).toBe('nothing')
  })

  test('choosing a runtime lists its pods, edges and policy', async () => {
    const el = await mount(await open(edge))
    await settle(el)
    await choose(el, 'r')
    for (const s of ['runtime r', 'api → db', 'none (everything allowed)']) expect(pane(el).textContent).toContain(s)
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

  describe('pod state', () => {
    const badge = (el: El, pod: string) => tree(el).shadowRoot.querySelector(`li[data-id="p:main:${pod}"] > .line .tag`)?.textContent
    test('given pods built and changed, then the badge follows built/closed; absent pods lose theirs', async () => {
      const o = await open(slice)
      const el = await mount(o)
      await settle(el)
      expect(badge(el, 'out')).toBeUndefined()
      await o.app.call('main', 'out').log(1)
      await o.app.call('main', 'up').map(1)
      await settle(el)
      expect(badge(el, 'out')).toBe('built')
      const d = o.app.deployment()
      must(await o.app.apply({ ...d, pods: { ...d.pods, out: Pod.lazy(log, { config: { max: 3 } }), wait: Pod.eager(debounce, { config: { quietMs: 20 } }) } }))
      await settle(el)
      expect(badge(el, 'out')).toBe('closed')
      expect(badge(el, 'wait')).toBe('built')
      expect(badge(el, 'up')).toBe('built')
      must(await o.app.restart('up'))
      await settle(el)
      expect(badge(el, 'up')).toBe('closed')
      const d2 = o.app.deployment()
      must(await o.app.apply({ pods: { in: d2.pods.in!, wait: d2.pods.wait!, out: d2.pods.out! }, runtimes: { main: { pods: ['in', 'wait', 'out'], subscriptions: [] } } }))
      await settle(el)
      expect(text(el)).not.toContain('up')
      expect(badge(el, 'up')).toBeUndefined()
    })
  })
})
