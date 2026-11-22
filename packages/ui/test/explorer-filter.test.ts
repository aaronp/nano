/** The explorer: application → runtimes → pods → edges, re-rendering on apply, drilling down through nano-open. */
import { describe, expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, Implementation, Pod, provide } from '@pritzlaff/nano-core'
import uiProvider, { debounce, log } from '../src/index.ts'
import { api, ns, must, Store, slice, open, El, mount, tree, settle, text } from './explorer-setup.ts'

describe('the explorer', () => {
  describe('the shared filter', () => {
    const dot = (el: El, pod: string) => tree(el).shadowRoot.querySelector(`li[data-id="p:main:${pod}"] > .line svg[role="img"]`)?.getAttribute('aria-label')
    const ids = (el: El) => [...tree(el).shadowRoot.querySelectorAll('li')].map(l => l.dataset.id)
    const filt = (el: El) => el.shadowRoot!.querySelector('nano-filter') as HTMLElement & { value: any; updateComplete: Promise<unknown> }
    const set = async (el: El, v: object) => { const f = filt(el); f.dispatchEvent(new CustomEvent('change', { detail: { text: '', kinds: new Set(), namespaces: new Set(), statuses: new Set(), ...v } })); await settle(el) }
    const reveal = async (el: El) => { (tree(el) as unknown as { reveal(id: string): void }).reveal('p:main:out'); await settle(el) }

    test('pods show a status dot: a lazy pod "not started", an eager one "running" after build', async () => {
      const el = await mount(await open(slice)); await settle(el); await reveal(el)
      expect(dot(el, 'out')).toBe('not started')
      expect(dot(el, 'in')).toBe('running')
      const labels = [...tree(el).shadowRoot.querySelectorAll('li[data-id="p:main:in"] > .line [aria-label]')].map(x => x.getAttribute('aria-label'))
      expect(labels).toEqual(expect.arrayContaining(['running', 'pod']))
      expect(tree(el).shadowRoot.querySelector('li[data-id="p:main:in"] > .line .kind')).toBeNull()
    })
    test('opened after pods were built, the explorer shows their real status', async () => {
      const o = await open(slice)
      await o.app.call('main', 'out').log(1)
      const el = await mount(o); await settle(el); await reveal(el)
      expect(dot(el, 'out')).toBe('running')
      expect(dot(el, 'up')).toBe('not started')
    })
    test('a throwing call leaves the pod running in the tree', async () => {
      const bad = Implementation.define(ns.implementationId('bad'), { provides: [Store], make: () => [provide(Store, { save: async () => { throw new Error('boom') } })] })
      const registry = Registry.create(); registry.add(uiProvider); registry.add(ns.provider([bad]))
      const d: AppDeployment = { pods: { bad: Pod.lazy(bad) }, runtimes: { main: { pods: ['bad'], subscriptions: [] } } }
      const app = must(await Application.create(must(AppDeployment.assemble(d, registry)), {}))
      const el = await mount({ app, registry }); await settle(el)
      await app.call('main', 'bad').save('x').catch(() => {}); await settle(el)
      expect(dot(el, 'bad')).toBe('running')
    })
    test('the explorer passes icon through to nano-tree', async () => {
      const el = await mount(await open(slice)); await settle(el)
      const own = () => undefined
      el.icon = own; await settle(el)
      expect((tree(el) as unknown as { icon: unknown }).icon).toBe(own)
    })
    test('a new target starts its pods over', async () => {
      const a = await open(slice), el = await mount(a); await settle(el)
      await a.app.call('main', 'out').log(1); must(await a.app.restart('in')); await settle(el)
      const b = await open({ pods: { out: Pod.lazy(log) }, runtimes: { main: { pods: ['out'], subscriptions: [] } } })
      el.target = b; await settle(el); await reveal(el)
      expect(dot(el, 'out')).toBe('not started')
    })
    test('choosing status "running" hides not-started pods', async () => {
      const el = await mount(await open(slice)); await settle(el)
      await set(el, { statuses: new Set(['running']) }); 
      const got = ids(el)
      expect(got).toContain('p:main:in'); expect(got).not.toContain('p:main:out')
    })
    test('kind chips and namespace chips narrow the tree', async () => {
      const el = await mount(await open(slice)); await settle(el)
      await set(el, { kinds: new Set(['pod']) })
      expect(ids(el).some(i => /(^|\|)[im]:/.test(i!))).toBe(false)
      expect(ids(el)).toContain('r:main')
      await set(el, { namespaces: new Set(['nope']) })   // unknown namespace: ignored
      expect(ids(el)).toContain('r:main')
      const both = await mount(await open({ ...slice, pods: { ...slice.pods, api: Pod.lazy(api) }, runtimes: { ...slice.runtimes, other: { pods: ['api'], subscriptions: [] } } })); await settle(both)
      await set(both, { namespaces: new Set(['acme']) })
      expect(ids(both)).toContain('p:other:api'); expect(ids(both)).not.toContain('p:main:in')
    })
    test("the selection's details stay when a filter hides it", async () => {
      const el = await mount(await open(slice)); await settle(el); await reveal(el)
      ;(tree(el).shadowRoot.querySelector('li[data-id="p:main:out"] > .line') as HTMLElement).click(); await settle(el)
      const before = el.shadowRoot!.querySelector('.details')!.textContent
      expect(before).toContain('out')
      await set(el, { statuses: new Set(['failed']) })
      expect(ids(el)).not.toContain('p:main:out')
      expect(el.shadowRoot!.querySelector('.details')!.textContent).toBe(before)
    })
  })
  describe('pod state', () => {
    const badge = (el: El, pod: string) => tree(el).shadowRoot.querySelector(`li[data-id="p:main:${pod}"] > .line svg[role="img"]`)?.getAttribute('aria-label')
    test('given pods built and changed, then the dot follows built/closed; absent pods lose theirs', async () => {
      const o = await open(slice)
      const el = await mount(o)
      await settle(el)
      expect(badge(el, 'out')).toBe('not started')
      await o.app.call('main', 'out').log(1)
      await o.app.call('main', 'up').map(1)
      await settle(el)
      expect(badge(el, 'out')).toBe('running')
      const d = o.app.deployment()
      must(await o.app.apply({ ...d, pods: { ...d.pods, out: Pod.lazy(log, { config: { max: 3 } }), wait: Pod.eager(debounce, { config: { quietMs: 20 } }) } }))
      await settle(el)
      expect(badge(el, 'out')).toBe('not started')   // changed: forgotten; lazy, so not rebuilt yet
      expect(badge(el, 'wait')).toBe('running')
      expect(badge(el, 'up')).toBe('running')
      must(await o.app.restart('up'))
      await settle(el)
      expect(badge(el, 'up')).toBe('not started')   // restarted: lazy, until called
      const d2 = o.app.deployment()
      must(await o.app.apply({ pods: { in: d2.pods.in!, wait: d2.pods.wait!, out: d2.pods.out! }, runtimes: { main: { pods: ['in', 'wait', 'out'], subscriptions: [] } } }))
      await settle(el)
      expect(text(el)).not.toContain('up')
      expect(badge(el, 'up')).toBeUndefined()
    })
  })
})
