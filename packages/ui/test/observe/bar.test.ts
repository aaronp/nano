import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
/**
 * `<nano-time-machine>`: its controls drive the time machine; it says when the clean start is gone and why no clock is driven.
 */
import { expect, test } from 'bun:test'
const { defineViews, memoryStore, record, timeMachine } = await import('../../src/index.ts')
import type { Entry, Recorded } from '../../src/observe/entry.ts'
import type { Ticker, TimeMachine } from '../../src/observe/time-machine.ts'
import { settle, typingSim } from './typing.ts'

defineViews()
const ticker: Ticker = { now: () => 0, frame: () => () => {} }
type Bar = HTMLElement & { tm?: TimeMachine; store?: unknown; driver?: unknown; updateComplete: Promise<unknown> }

async function mount(props: Partial<Bar>) {
  const el = document.createElement('nano-time-machine') as Bar
  Object.assign(el, props)
  document.body.replaceChildren(el)
  await el.updateComplete
  return el
}
const $ = <T extends Element>(el: Bar, sel: string) => el.shadowRoot!.querySelector<T>(sel)!
const click = async (el: Bar, label: string) => { $<HTMLButtonElement>(el, `button[aria-label="${label}"]`).click(); await el.updateComplete }

/** Three messages at 0, 100 and 200 ms, through a hand-filled store. */
async function three() {
  const store = memoryStore(), heard = new Set<(e: Entry) => void>()
  const sent = (id: string): Recorded => ({ type: 'sent', id, runtime: 'main', kind: 'call', from: 'host', to: 'input', port: 'p', correlation: id })
  ;[0, 100, 200].forEach((at, i) => store.append({ seq: i + 1, at, event: sent(`m${i}`) }))
  return timeMachine({ store, listen: fn => { heard.add(fn); return () => { heard.delete(fn) } } }, { ticker })
}

test('play, pause, step, a speed and Live drive the time machine; the slider seeks; Reset is an event', async () => {
  const tm = await three(), el = await mount({ tm })
  await click(el, 'Step back')
  expect(tm.mode).toBe('paused')
  expect(tm.cursor).toBe(100)
  await click(el, 'Step back')
  expect(tm.cursor).toBe(0)
  await click(el, 'Step forward')
  expect(tm.cursor).toBe(100)
  await click(el, 'Play')
  expect(tm.mode).toBe('playing')
  await click(el, 'Pause')
  expect(tm.mode).toBe('paused')

  const speed = $<HTMLSelectElement>(el, 'select[aria-label="Speed"]')
  speed.value = String(1 / 10); speed.dispatchEvent(new Event('change'))
  expect(tm.speed).toBeCloseTo(1 / 10)

  const slider = $<HTMLInputElement>(el, 'input[type=range]')
  expect([slider.min, slider.max]).toEqual(['0', '200'])
  slider.value = '50'; slider.dispatchEvent(new Event('input'))
  expect(tm.cursor).toBe(50)

  await click(el, 'Live')
  expect(tm.mode).toBe('live')

  let resets = 0
  el.addEventListener('reset', () => resets++)
  await click(el, 'Reset')
  expect(resets).toBe(1)
  tm.close()
})

test('given the clean start dropped off the store, then the bar says history is too long to rebuild state', async () => {
  const app = await typingSim()
  const store = memoryStore({ max: 20 }), rec = await record(app, store, { clean: true })
  const tm = await timeMachine({ store, listen: rec.listen }, { ticker })
  const el = await mount({ tm, store })
  expect(el.shadowRoot!.textContent).not.toContain('history too long to rebuild state')
  for (const c of 'abcdefghij') await app.call('main', 'input').change(c)
  await settle(); await el.updateComplete; await settle(); await el.updateComplete
  expect(el.shadowRoot!.textContent).toContain('history too long to rebuild state')
  tm.close(); rec.stop(); await app.close()
})

test('the driver’s reason is shown', async () => {
  const el = await mount({ tm: await three(), driver: { driving: null, reason: 'no pod provides ClockControl' } })
  expect(el.shadowRoot!.textContent).toContain('no pod provides ClockControl')
})
