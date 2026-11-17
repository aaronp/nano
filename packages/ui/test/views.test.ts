/**
 * Pod views over the nano.ui slice: chosen by selector, default or generic; reaching the pod only by call and listen.
 */
import { describe, expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, Pod, port, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider, { Debounce, debounce, defineViews, input, Input, Log, log, map, MapIface, views, viewFor, type ViewTarget } from '../src/index.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const slice: AppDeployment = {
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
const open = async () => {
  const registry = Registry.create()
  registry.add(uiProvider)
  return { app: must(await Application.create(must(AppDeployment.assemble(slice, registry)), {})), registry }
}
const mount = async (tag: string, target: ViewTarget) => {
  const el = document.createElement(tag) as HTMLElement & { target: ViewTarget; updateComplete: Promise<unknown> }
  el.target = target
  document.body.append(el)
  await el.updateComplete
  return el
}
const text = (el: Element) => el.shadowRoot?.textContent ?? ''

defineViews()

describe('pod views', () => {
  test('viewFor: the deployment selector wins, then the implementation default, then nano-pod-view', async () => {
    const { app } = await open()
    const d = { ...app.deployment(), views: { up: 'nano-log' } }
    expect(viewFor('up', d, views)).toBe('nano-log')
    expect(viewFor('out', d, views)).toBe('nano-log')
    expect(viewFor('in', d, views)).toBe('nano-input')
    expect(viewFor('in', d, {})).toBe('nano-pod-view')
  })

  test('viewFor: a selector naming an undefined tag falls back to nano-pod-view', async () => {
    const { app } = await open()
    expect(viewFor('up', { ...app.deployment(), views: { up: 'no-such-view' } }, {})).toBe('nano-pod-view')
  })

  test('given nano-input and nano-log on the slice, when "hi" is entered, then nano-log shows HI', async () => {
    const { app, registry } = await open()
    const field = await mount('nano-input', { app, registry, runtime: 'main', pod: 'in' })
    const shown = await mount('nano-log', { app, registry, runtime: 'main', pod: 'out' })
    const box = field.shadowRoot!.querySelector('input')!
    box.value = 'hi'
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await sleep(40)
    await (shown as unknown as { updateComplete: Promise<unknown> }).updateComplete
    expect(text(shown)).toContain('HI')
  })

  test('given nano-pod-view on up, when map is called twice, then it shows 2 calls to nano.ui.Map/map and the last result', async () => {
    const { app, registry } = await open()
    const el = await mount('nano-pod-view', { app, registry, runtime: 'main', pod: 'up' })
    await app.call('main', 'up').map('a')
    await app.call('main', 'up').map('b')
    await el.updateComplete
    const row = [...el.shadowRoot!.querySelectorAll('[data-port]')].find(r => r.getAttribute('data-port') === 'nano.ui.Map/map')!
    expect(row.textContent).toContain('2')
    expect(row.textContent).toContain('"B"')
    expect(text(el)).toContain('nano.ui/map')
    expect(text(el)).toContain('main')
  })

  test('given nano-map on up, when map is called with "hi", then it shows its code and the output HI', async () => {
    const { app, registry } = await open()
    const el = await mount('nano-map', { app, registry, runtime: 'main', pod: 'up' })
    await app.call('main', 'up').map('hi')
    await el.updateComplete
    expect(text(el)).toContain('toUpperCase')
    expect(text(el)).toContain('"HI"')
  })

  test('given nano-debounce on wait, when pushed, then pending; after flushed, it flashes, then idle', async () => {
    const { app, registry } = await open()
    const el = await mount('nano-debounce', { app, registry, runtime: 'main', pod: 'wait' })
    expect(text(el)).toContain('idle')
    await app.call('main', 'wait').push('x')
    await el.updateComplete
    expect(text(el)).toContain('pending')
    await sleep(30)
    await el.updateComplete
    expect(text(el)).toContain('flushed')
    await sleep(320)
    await el.updateComplete
    expect(text(el)).toContain('idle')
  })

  test('given nano-pod-view on up, when apply changes its config, then it shows the new config', async () => {
    const { app, registry } = await open()
    const el = await mount('nano-pod-view', { app, registry, runtime: 'main', pod: 'up' })
    must(await app.apply({ ...slice, pods: { ...slice.pods, up: Pod.lazy(map, { config: { code: 'return 7' } }) } }))
    await el.updateComplete
    expect(text(el)).toContain('return 7')
  })

  test('given a mounted view, when apply removes its pod, then it renders removed and its listener is gone', async () => {
    const { app, registry } = await open()
    let listening = 0
    const counted = { ...app, listen: (fn: Parameters<typeof app.listen>[0]) => { listening++; const off = app.listen(fn); return () => { listening--; off() } } }
    const el = await mount('nano-log', { app: counted, registry, runtime: 'main', pod: 'out' })
    expect(listening).toBe(1)
    const { out: _, ...pods } = slice.pods
    must(await app.apply({ pods, runtimes: { main: { pods: ['in', 'wait', 'up'], subscriptions: slice.runtimes.main!.subscriptions.slice(0, 2) } } }))
    await el.updateComplete
    expect(text(el)).toContain('removed')
    expect(listening).toBe(0)
    el.remove()
    expect(listening).toBe(0)
  })
})
