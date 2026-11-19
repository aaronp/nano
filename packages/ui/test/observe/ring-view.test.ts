import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
/**
 * `<nano-ring>`: each pod's view on the ring, the frame's dots, and the views bound to an app rebuilt to the cursor
 * when it is in the past.
 */
import { afterEach, expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, success } from '@pritzlaff/nano-core'
const { default: uiProvider, defineViews, memoryStore, record, timeMachine } = await import('../../src/index.ts')
import type { ViewTarget } from '../../src/views/view.ts'
import type { Ticker, TimeMachine } from '../../src/observe/time-machine.ts'
import { must, settle, sleep, typingSim } from './typing.ts'

defineViews()
const ticker: Ticker = { now: () => 0, frame: () => () => {} }
const registry = Registry.create()
must(registry.add(uiProvider))
const create = (d: AppDeployment) => Application.create(must(AppDeployment.assemble(d, registry)), {})
type Ring = HTMLElement & { updateComplete: Promise<unknown> }
type View = HTMLElement & { target?: ViewTarget }

/** Typing on the sim clock, recorded from a clean start: "hi" at 1 (logged HI), "hey" at 10 (logged HEY). */
async function typed(store = memoryStore()) {
  const app = await typingSim()
  let now = 1
  const rec = await record(app, store, { clean: true, now: () => now })
  const input = app.call('main', 'input'), clock = app.call('main', 'clock')
  for (const [at, step] of [[1, () => input.change('hi')], [1, () => clock.advance(1000)], [10, () => input.change('hey')], [10, () => clock.advance(1000)]] as const) {
    now = at; await step(); await settle()
  }
  const tm = await timeMachine({ store, listen: rec.listen }, { ticker })
  return { app, store, rec, tm }
}

let cleanup: (() => Promise<void>) | undefined
afterEach(async () => { await cleanup?.(); cleanup = undefined })

async function mount(props: { app: Application; tm: TimeMachine; store: unknown; show?: unknown; views?: unknown }) {
  const el = document.createElement('nano-ring') as Ring
  Object.assign(el, { registry, create, ...props })
  document.body.replaceChildren(el)
  await el.updateComplete
  return el
}
const views = (el: Ring) => [...el.shadowRoot!.querySelectorAll<HTMLElement>('[data-pod]')].map(w => ({ wrap: w, view: w.lastElementChild as View }))
const settled = async (el: Ring) => { await sleep(300); await settle(); await el.updateComplete }

async function ring(store?: ReturnType<typeof memoryStore>) {
  const t = await typed(store), el = await mount({ app: t.app, tm: t.tm, store: t.store })
  cleanup = async () => { el.remove(); t.tm.close(); t.rec.stop(); await t.app.close() }
  return { ...t, el }
}

test("renders Typing's pods as their views", async () => {
  const { el, app, tm, store } = await ring()
  const vs = views(el)
  expect(vs.map(v => v.wrap.dataset.pod)).toEqual(['input', 'debounce', 'map', 'log', 'clock'])
  expect(vs.map(v => v.view.localName)).toEqual(['nano-input', 'nano-debounce', 'nano-map', 'nano-log', 'b'])   // the clock has no view: its label only
  for (const { wrap, view } of vs.slice(0, 4)) {
    expect(view.target).toMatchObject({ app, registry, runtime: 'main', pod: wrap.dataset.pod })
    expect(wrap.style.left).toMatch(/px$/)
    expect(wrap.inert).toBe(false)
  }
  const shown = await mount({ app, tm, store, show: (_p: string, impl: string) => impl === 'nano.ui/log' })
  expect(views(shown).map(v => v.wrap.dataset.pod)).toEqual(['log'])
})

test('scrubbing back rebinds the views to a shadow app, inert', async () => {
  const { el, app, tm } = await ring()
  tm.seek(5)
  await settled(el)
  const vs = views(el), shadow = vs[0]!.view.target!.app
  expect(shadow).not.toBe(app)
  for (const { wrap, view } of vs.slice(0, 4)) { expect(view.target!.app).toBe(shadow); expect(wrap.inert).toBe(true) }
  expect(await shadow.call('main', 'log').entries(null)).toEqual(success(['HI']))
  const logText = () => views(el).find(v => v.wrap.dataset.pod === 'log')!.view.shadowRoot!.textContent
  expect(logText()).toContain('HI'); expect(logText()).not.toContain('HEY')   // the drawn log is the rebuilt one
  expect(await app.call('main', 'log').entries(null)).toEqual(success(['HI', 'HEY']))
})

test('Live rebinds to the live app', async () => {
  const { el, app, tm } = await ring()
  tm.seek(5)
  await settled(el)
  const shadow = views(el)[0]!.view.target!.app
  tm.live()
  await el.updateComplete
  for (const { wrap, view } of views(el).slice(0, 4)) { expect(view.target!.app).toBe(app); expect(wrap.inert).toBe(false) }
  await settle(); await sleep(50)
  expect(views(el).find(v => v.wrap.dataset.pod === 'log')!.view.shadowRoot!.textContent).toContain('HEY')   // live again

  expect((await shadow.call('main', 'log').entries(null)).ok).toBe(false)   // closed
})

test('too-long shows the message and stays live', async () => {
  const store = memoryStore({ max: 20 }), app = await typingSim()
  let now = 0
  const rec = await record(app, store, { clean: true, now: () => now })
  for (const c of 'abcdefghij') { now++; await app.call('main', 'input').change(c); await settle() }
  const tm = await timeMachine({ store, listen: rec.listen }, { ticker }), el = await mount({ app, tm, store })
  cleanup = async () => { el.remove(); tm.close(); rec.stop(); await app.close() }
  tm.seek(now - 1)
  await settled(el)
  expect(el.shadowRoot!.textContent).toContain('history too long to rebuild state')
  for (const { wrap, view } of views(el).slice(0, 4)) { expect(view.target!.app).toBe(app); expect(wrap.inert).toBe(false) }
})

test('a dot click seeks', async () => {
  const { el, tm } = await ring()
  tm.seek(5)
  await el.updateComplete
  const dots = el.shadowRoot!.querySelectorAll<SVGCircleElement>('circle[data-dot]')
  expect(dots.length).toBeGreaterThan(0)
  dots[0]!.dispatchEvent(new Event('click'))
  expect(tm.mode).toBe('paused')
  expect(tm.cursor).toBe(1)
})

test('a pod whose implementation is in views renders as that tag', async () => {
  if (!customElements.get('test-log-view')) customElements.define('test-log-view', class extends HTMLElement {})
  const { app, tm, store } = await ring()
  const el = await mount({ app, tm, store, views: { 'nano.ui/log': 'test-log-view' } })
  expect(views(el).map(v => v.view.localName)).toEqual(['nano-input', 'nano-debounce', 'nano-map', 'test-log-view', 'b'])
  const picked = await mount({ app, tm, store, views: { 'nano.ui/sim-clock': 'nano-pod-view' } })   // asked for: the generic view
  expect(views(picked).at(-1)!.view.localName).toBe('nano-pod-view')
})

test('scrubbing back draws the deployment at the cursor, not the live one', async () => {
  const { el, app, tm } = await ring()
  const d = app.deployment(), main = d.runtimes['main']!, { log: _, ...kept } = d.pods
  must(await app.apply({ ...d, pods: { ...kept, extra: { implementation: 'nano.ui/log', eager: false } }, runtimes: {   // after t: log out, a runtime in
    main: { pods: main.pods.filter(p => p !== 'log'), subscriptions: main.subscriptions.filter(s => s.from !== 'log' && s.to !== 'log') },
    side: { pods: ['extra'], subscriptions: [] } } }))
  await el.updateComplete
  const pods = () => views(el).map(v => v.wrap.dataset.pod)
  expect(pods()).toContain('extra'); expect(pods()).not.toContain('log')
  tm.seek(5)
  await settled(el)
  expect(pods()).toEqual(['input', 'debounce', 'map', 'log', 'clock'])
  expect(el.shadowRoot!.querySelector('text')!.textContent).toBe('main')
})
