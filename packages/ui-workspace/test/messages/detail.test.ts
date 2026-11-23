// The detail's cause labels and its close button.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import type { Message } from '@pritzlaff/nano-ui'

const { render } = await import('lit')
const { renderDetail } = await import('../../src/messages/detail.ts')
const msg = (id: string, from: string, cause?: string, ms = 1.1999999955): Message => ({
  at: 0, sent: { id, runtime: 'main', kind: 'call', from, to: 'x', port: 'go', correlation: id, ...(cause && { cause }) },
  outcome: { type: 'delivered', ok: true, result: '1', ms } } as Message)
const text = (m: Message, chain: Message[], close?: () => void) => {
  const d = document.createElement('div'); render(renderDetail(m, chain, () => {}, close), d); return d
}

test('root only for a host message with no cause; otherwise the cause is not recorded', () => {
  expect(text(msg('a', 'host'), []).textContent).toContain('(root message)')
  expect(text(msg('a', 'ui'), []).textContent).toContain('(cause not recorded)')
})

test('a chain that stops on a missing id says so; ms is rounded', () => {
  const t = text(msg('b', 'ui', 'gone'), []).textContent!
  expect(t).toContain('(earlier causes no longer in the history)')
  expect(t).toContain('1.2 ms')
  expect(text(msg('c', 'ui', 'b'), [msg('b', 'ui', 'gone')]).textContent).toContain('(earlier causes no longer in the history)')
})

test('the close button calls onClose and does not bubble', () => {
  let n = 0, bubbled = false
  const d = text(msg('a', 'host'), [], () => n++)
  d.addEventListener('click', () => { bubbled = true })
  d.querySelector<HTMLElement>('[data-close]')!.click()
  expect(n).toBe(1); expect(bubbled).toBe(false)
})

test('a start has no port: its label names the kind', () => {
  const m = { at: 0, sent: { id: 's', runtime: 'main', kind: 'start', from: 'host', to: 'c', correlation: 's' } } as Message
  const t = text(m, []).querySelector('h3')!.textContent!
  expect(t).toContain('host → c (start)'); expect(t).not.toContain('undefined')
})
