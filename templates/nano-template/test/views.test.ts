import { describe, expect, test } from 'bun:test'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { must, open, sleep } from './app.ts'

type El = HTMLElement & { target: ViewTarget; updateComplete: Promise<unknown> }
const mount = async (tag: string, t: ViewTarget) => {
  const el = document.createElement(tag) as El
  el.target = t
  document.body.append(el)
  await el.updateComplete
  return el
}
const click = (el: El, label: string) => [...el.shadowRoot!.querySelectorAll('button')].find(b => b.textContent === label)!.click()

describe('the views', () => {
  test('<nano-timer> counts ticks after Start, and stops after Stop', async () => {
    const { app, registry } = await open()
    const el = await mount('nano-timer', { app, registry, runtime: 'main', pod: 'timer' })
    click(el, 'Start')
    await sleep(60)
    await el.updateComplete
    const n = Number(el.shadowRoot!.querySelector('.badge')!.textContent)
    expect(n).toBeGreaterThan(1)
    click(el, 'Stop')
    await sleep(40)
    await el.updateComplete
    const stopped = Number(el.shadowRoot!.querySelector('.badge')!.textContent)
    await sleep(40)
    await el.updateComplete
    expect(Number(el.shadowRoot!.querySelector('.badge')!.textContent)).toBe(stopped)
  })

  test('<nano-timer> counts its own ticks with no pipe from its pod, and ends its subscription when removed', async () => {
    const { app, registry } = await open(true)
    const el = await mount('nano-timer', { app, registry, runtime: 'main', pod: 'timer' })
    click(el, 'Start')
    await sleep(60)
    await el.updateComplete
    expect(Number(el.shadowRoot!.querySelector('.badge')!.textContent)).toBeGreaterThan(1)
    const it = (el as unknown as { iter?: AsyncIterator<unknown> }).iter!
    el.remove()
    expect(await it.next()).toEqual({ done: true, value: undefined })
  })

  test('<nano-picker> renders the kit select, whose change picks', async () => {
    const { app, registry } = await open()
    const el = await mount('nano-picker', { app, registry, runtime: 'main', pod: 'picker' })
    await sleep(10)
    await el.updateComplete
    const select = el.shadowRoot!.querySelector('nano-select') as HTMLElement & { value: string }
    select.value = 'blue'
    select.dispatchEvent(new Event('change'))
    await sleep(20)
    expect(must(await app.call('main', 'store').get('choice'))).toBe('blue')
  })

  test('<nano-store> lists entries as they are set, and removes one', async () => {
    const { app, registry } = await open()
    const el = await mount('nano-store', { app, registry, runtime: 'main', pod: 'store' })
    must(await app.call('main', 'store').set({ key: 'a', value: '1' }))
    await sleep(20)
    await el.updateComplete
    expect(el.shadowRoot!.textContent).toContain('a')
    el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Remove a"]')!.click()
    await sleep(20)
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('tr')).toBeNull()
  })
})
