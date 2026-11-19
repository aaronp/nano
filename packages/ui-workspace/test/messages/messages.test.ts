// The Messages page: a searchable table that follows the page's time machine, and the detail of a message.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import type { Entry, Ticker } from '@pritzlaff/nano-ui'
import type { Messages } from '../../src/messages/index.ts'

const { memoryStore, timeMachine } = await import('@pritzlaff/nano-ui')
const { defineMessages } = await import('../../src/messages/index.ts')

defineMessages()
const tick = () => new Promise(r => setTimeout(r, 0))
const ticker: Ticker = { now: () => 0, frame: () => () => {} }
const sent = (seq: number, at: number, id: string, to: string, input: string, cause?: string): Entry =>
  ({ seq, at, event: { type: 'sent', id, runtime: 'main', kind: 'call', from: 'ui', to, port: 'go', correlation: cause ?? id, ...(cause && { cause }), input } })
const done = (seq: number, at: number, id: string, result: string): Entry => ({ seq, at, event: { type: 'delivered', id, ok: true, result, ms: 7 } })

async function page() {
  const store = memoryStore()
  for (const e of [sent(1, 100, 'a', 'alice', '"hello"'), done(2, 110, 'a', '"ok-a"'), sent(3, 200, 'b', 'bob', '{"n":2}', 'a'), done(4, 210, 'b', '"ok-b"')]) store.append(e)
  const tm = await timeMachine({ store, listen: () => () => {} }, { ticker })
  const el = document.createElement('c-messages') as Messages
  Object.assign(el, { tm, store }); document.body.replaceChildren(el)
  await el.updateComplete; await tick()
  const rows = () => [...el.shadowRoot!.querySelectorAll('tbody tr')] as HTMLElement[]
  return { tm, el, rows }
}

test('rows follow the cursor, and the row at the cursor is highlighted', async () => {
  const { tm, el, rows } = await page()
  expect(rows().length).toBe(2)
  tm.seek(150); await el.updateComplete
  expect(rows().length).toBe(1)
  expect(rows()[0]!.hasAttribute('data-at')).toBe(true)
  expect(rows()[0]!.textContent).toContain('alice')
})

test('search filters rows by pod, port or value', async () => {
  const { el, rows } = await page()
  const q = (t: string) => { const i = el.shadowRoot!.querySelector('input')!; i.value = t; i.dispatchEvent(new Event('input')) }
  q('bob'); await el.updateComplete
  expect(rows().length).toBe(1)
  q('hello'); await el.updateComplete
  expect(rows()[0]!.textContent).toContain('alice')
  q('go'); await el.updateComplete
  expect(rows().length).toBe(2)
  q('zzz'); await el.updateComplete
  expect(rows().length).toBe(0)
})

test('a row click pauses the timeline there and opens the detail', async () => {
  const { tm, el, rows } = await page()
  rows()[1]!.click(); await el.updateComplete; await tick(); await el.updateComplete
  expect(tm.mode).toBe('paused')
  expect(tm.cursor).toBe(100)
  expect(el.shadowRoot!.querySelector('[data-detail]')!.textContent).toContain('"hello"')
})

test('the detail shows input, result, ms and the cause chain; a cause seeks to it', async () => {
  const { tm, el, rows } = await page()
  rows()[0]!.click(); await tick(); await el.updateComplete
  const d = el.shadowRoot!.querySelector('[data-detail]')!
  for (const s of ['{"n":2}', '"ok-b"', '7.0 ms']) expect(d.textContent).toContain(s)
  const cause = d.querySelector<HTMLElement>('[data-cause]')!
  expect(cause.textContent).toContain('alice')
  cause.click(); await el.updateComplete
  expect(tm.cursor).toBe(100)
})
