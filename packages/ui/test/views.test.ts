/** Pod views over the nano.ui slice: chosen by selector, default or generic; reaching the pod only by call and listen. */
import { describe, expect, test } from 'bun:test'
import { Pod, port } from '@pritzlaff/nano-core'
import { debounce, input, log, map, views, viewFor } from '../src/index.ts'
import { must, sleep, slice, open, mount, text } from './views-setup.ts'

describe('pod views', () => {
  test('viewFor: the pod\'s override wins, then the implementation default, then nano-pod-view', async () => {
    const { app } = await open()
    const d = app.deployment(), overrides = { up: 'nano-log' }
    expect(viewFor('up', d, views, overrides)).toBe('nano-log')
    expect(viewFor('out', d, views, overrides)).toBe('nano-log')
    expect(viewFor('in', d, views)).toBe('nano-input')
    expect(viewFor('in', d, {})).toBe('nano-pod-view')
  })

  test('viewFor: an override naming an undefined tag falls back to nano-pod-view', async () => {
    const { app } = await open()
    expect(viewFor('up', app.deployment(), {}, { up: 'no-such-view' })).toBe('nano-pod-view')
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

  test('given nano-debounce on wait, when values are pushed, then they wait in the queue with their values, and drop as one batch', async () => {
    const { app, registry } = await open()
    must(await app.apply({ ...slice, pods: { ...slice.pods, wait: Pod.eager(debounce, { config: { quietMs: 60 } }) } }))
    const el = await mount('nano-debounce', { app, registry, runtime: 'main', pod: 'wait' })
    expect(text(el)).toContain('idle')
    await app.call('main', 'wait').push('ab')
    await app.call('main', 'wait').push('cd')
    await el.updateComplete
    expect(text(el)).toContain('collecting 2')
    expect([...el.shadowRoot!.querySelectorAll('.item')].map(i => i.textContent)).toEqual(['ab', 'cd'])
    await sleep(100)
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.ratio')!.textContent).toBe('2 → 1 batches')
    expect(text(el)).toContain('dropping 2')
  })
})
