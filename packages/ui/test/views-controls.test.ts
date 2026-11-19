/** Pod views over the nano.ui slice: chosen by selector, default or generic; reaching the pod only by call and listen. */
import { describe, expect, test } from 'bun:test'
import { Pod } from '@pritzlaff/nano-core'
import { debounce, input, Input, log, map, views } from '../src/index.ts'
import { must, sleep, slice, open, mount, text } from './views-setup.ts'

describe('pod views', () => {
  test('given nano-debounce, when the quiet slider is released, then the pod is applied with that quiet period', async () => {
    const { app, registry } = await open()
    const el = await mount('nano-debounce', { app, registry, runtime: 'main', pod: 'wait' })
    const quiet = el.shadowRoot!.querySelector<HTMLInputElement>('input[aria-label="Quiet period in milliseconds"]')!
    quiet.value = '450'
    quiet.dispatchEvent(new Event('change'))
    await sleep(10)
    expect(app.deployment().pods['wait']!.config).toEqual({ quietMs: 450 })
    el.shadowRoot!.querySelector<HTMLInputElement>('input[aria-label="Use max wait"]')!.click()
    await sleep(10)
    expect(app.deployment().pods['wait']!.config).toEqual({ quietMs: 450, maxWaitMs: 1000 })
    await app.call('main', 'wait').push('after')   // the pod restarted with its new config: the view still hears it
    await el.updateComplete
    expect([...el.shadowRoot!.querySelectorAll('.item')].map(i => i.textContent)).toEqual(['aft…'])
    el.shadowRoot!.querySelector<HTMLInputElement>('input[aria-label="Use max wait"]')!.click()
    await sleep(10)
    expect(app.deployment().pods['wait']!.config).toEqual({ quietMs: 450 })
  })

  test('given nano-input, every edit calls change and the kind picker makes it a number field sending numbers', async () => {
    const { app, registry } = await open()
    const field = await mount('nano-input', { app, registry, runtime: 'main', pod: 'in' })
    const changes: unknown[] = []
    app.runtime('main').subscribe(Input.ops.change, ({ input }) => { changes.push(input) })
    const box = () => field.shadowRoot!.querySelector('input')!
    box().value = 'h'; box().dispatchEvent(new Event('input'))
    box().value = 'hi'; box().dispatchEvent(new Event('input'))
    await sleep(5)
    expect(changes).toEqual(['h', 'hi'])
    const pick = field.shadowRoot!.querySelector('select')!
    pick.value = 'number'; pick.dispatchEvent(new Event('change'))
    await sleep(10); await field.updateComplete
    expect(app.deployment().pods['in']!.config).toEqual({ kind: 'number' })
    expect(box().type).toBe('number')
    box().value = '42'; box().dispatchEvent(new Event('input'))
    await sleep(5)
    expect(changes.at(-1)).toBe(42)
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
