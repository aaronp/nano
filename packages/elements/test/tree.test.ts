// <nano-tree>: nodes in a tree; opening, filtering, selecting, revealing and the keyboard.
import { expect, test } from 'bun:test'
import { html } from 'lit'
import '../src'
import type { TreeNode } from '../src'

type El = HTMLElement & { updateComplete: Promise<boolean>; [k: string]: any }
const tick = () => new Promise(r => setTimeout(r, 0))
const settle = async (el: El) => { for (let i = 0; i < 3; i++) { await el.updateComplete; await tick() } }

const NODES: TreeNode[] = [
  { id: 'commerce', label: 'Commerce', kind: 'system', count: 2, children: [
    { id: 'commerce/payments', label: 'Payments', kind: 'component', badge: '↗ 2 systems', children: [
      { id: 'commerce/payments/authorise', label: 'authorise', kind: 'action', terms: ['PaymentRequest', 'Authorisation'], body: html`<div class="sig">PaymentRequest → Authorisation</div>` },
      { id: 'commerce/payments/refund', label: 'refund', kind: 'action', terms: ['RefundRequest', 'RefundResult'] }] },
    { id: 'commerce/orders', label: 'Orders', kind: 'component', end: html`<button class="go">go</button>`, children: [
      { id: 'commerce/orders/place', label: 'placeOrder', kind: 'action' }] }] },
  { id: 'billing', label: 'Billing', kind: 'system', count: 1, children: [
    { id: 'billing/payments', label: 'Payments', kind: 'component', children: [{ id: 'billing/payments/refund', label: 'refund', kind: 'action' }] }] },
  { id: 'analytics', label: 'Analytics', kind: 'system', count: 0 },
]

const tree = async (attrs = '') => {
  document.body.innerHTML = `<nano-tree ${attrs}></nano-tree>`
  const t = document.querySelector('nano-tree') as El
  t.nodes = NODES; await settle(t)
  const $ = (s: string) => t.shadowRoot!.querySelector(s) as HTMLElement | null
  const item = (id: string) => $(`[role="treeitem"][data-id="${id}"]`)
  const visible = () => [...t.shadowRoot!.querySelectorAll('[role="treeitem"]')].map(e => (e as HTMLElement).dataset.id)
  const key = async (k: string) => { (t.shadowRoot!.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true })); await settle(t) }
  const focused = () => (t.shadowRoot!.activeElement as HTMLElement | null)?.dataset.id
  return { t, $, item, visible, key, focused }
}

test('a tree of treeitems with levels; open-depth opens the top levels, the chevron opens and closes', async () => {
  const { t, $, item, visible } = await tree('open-depth="1"')
  expect($('[role="tree"]')).not.toBeNull()
  expect(visible()).toEqual(['commerce', 'commerce/payments', 'commerce/orders', 'billing', 'billing/payments', 'analytics'])
  expect(item('commerce')!.getAttribute('aria-level')).toBe('1')
  expect(item('commerce/payments')!.getAttribute('aria-level')).toBe('2')
  expect(item('commerce')!.getAttribute('aria-expanded')).toBe('true')
  expect(item('commerce/payments')!.getAttribute('aria-expanded')).toBe('false')
  expect(item('analytics')!.hasAttribute('aria-expanded')).toBe(false)   // nothing in it
  ;($('[data-toggle="commerce/payments"]') as HTMLElement).click(); await settle(t)
  expect(visible()).toContain('commerce/payments/authorise')
  ;($('[data-toggle="commerce"]') as HTMLElement).click(); await settle(t)
  expect(visible()).toEqual(['commerce', 'billing', 'billing/payments', 'analytics'])
  expect(t.selected ?? null).toBeNull()   // the chevron doesn't select
})

test('kind, count, badge, end and body are shown', async () => {
  const { t, item, $ } = await tree('open-depth="3"')
  const row = item('commerce')!.querySelector('.line')!
  expect(row.querySelector('.kind')!.textContent).toBe('system')
  expect(row.querySelector('.count')!.textContent).toBe('2')
  expect(item('commerce/payments')!.querySelector('.tag')!.textContent).toBe('↗ 2 systems')
  expect(item('commerce/orders')!.querySelector('.line .go')).not.toBeNull()
  expect($('.sig')!.textContent).toBe('PaymentRequest → Authorisation')
  ;($('[data-toggle="commerce/payments/authorise"]') as HTMLElement).click(); await settle(t)
  expect($('.sig')).toBeNull()   // a body shows only while open
})

test('clicking a row selects it (cancelable) and opens or closes it; clicking a button in it does neither', async () => {
  const { t, $, item, visible } = await tree('open-depth="1"')
  const seen: string[] = []
  t.addEventListener('select', e => seen.push((e as CustomEvent).detail.id))
  ;(item('commerce/payments')!.querySelector('.line') as HTMLElement).click(); await settle(t)
  expect(seen).toEqual(['commerce/payments'])
  expect(t.selected).toBe('commerce/payments')
  expect(item('commerce/payments')!.getAttribute('aria-selected')).toBe('true')
  expect(visible()).toContain('commerce/payments/refund')
  ;($('.go') as HTMLElement).click(); await settle(t)
  expect(seen).toEqual(['commerce/payments'])
  t.addEventListener('select', e => e.preventDefault())
  ;(item('billing/payments')!.querySelector('.line') as HTMLElement).click(); await settle(t)
  expect(seen.at(-1)).toBe('billing/payments')
  expect(t.selected).toBe('commerce/payments')   // cancelled: the host decides
})

test('the query keeps matches with their ancestors (open) and subtree, any case, by label or terms, and marks them', async () => {
  const { t, $, visible } = await tree()
  t.query = 'REFUND'; await settle(t)
  expect(visible()).toEqual(['commerce', 'commerce/payments', 'commerce/payments/refund', 'billing', 'billing/payments', 'billing/payments/refund'])
  expect($('mark')!.textContent).toBe('refund')
  t.query = 'authorisation'; await settle(t)   // a term
  expect(visible()).toEqual(['commerce', 'commerce/payments', 'commerce/payments/authorise'])
  t.query = 'orders'; await settle(t)   // a match brings its subtree
  expect(visible()).toEqual(['commerce', 'commerce/orders', 'commerce/orders/place'])
  t.query = 'zzz'; await settle(t)
  expect(visible()).toEqual([])
  expect($('.empty')!.textContent).toContain('Nothing matches')
  t.query = ''; await settle(t)
  expect(visible()).toEqual(['commerce', 'billing', 'analytics'])   // as opened before
})

test('the keyboard: one tab stop; arrows move, open and close; Home, End; Enter selects; a letter jumps', async () => {
  const { t, item, key, focused, visible } = await tree()
  expect([...t.shadowRoot!.querySelectorAll('[tabindex="0"]')].map(e => (e as HTMLElement).dataset.id)).toEqual(['commerce'])
  item('commerce')!.focus()
  await key('ArrowDown'); expect(focused()).toBe('billing')
  await key('ArrowRight'); expect(visible()).toContain('billing/payments'); expect(focused()).toBe('billing')
  await key('ArrowRight'); expect(focused()).toBe('billing/payments')
  await key('ArrowLeft'); expect(focused()).toBe('billing')
  await key('ArrowLeft'); expect(visible()).not.toContain('billing/payments')
  await key('End'); expect(focused()).toBe('analytics')
  await key('Home'); expect(focused()).toBe('commerce')
  await key('ArrowUp'); expect(focused()).toBe('commerce')
  await key('a'); expect(focused()).toBe('analytics')
  await key('Enter'); expect(t.selected).toBe('analytics')
  expect([...t.shadowRoot!.querySelectorAll('[tabindex="0"]')].map(e => (e as HTMLElement).dataset.id)).toEqual(['analytics'])
})

test('reveal opens the way to a node and focuses it', async () => {
  const { t, visible, focused } = await tree()
  t.reveal('billing/payments/refund'); await settle(t)
  expect(visible()).toEqual(['commerce', 'billing', 'billing/payments', 'billing/payments/refund', 'analytics'])
  expect(focused()).toBe('billing/payments/refund')
})

test('reveal without focus opens the way, and moves the tab stop, but leaves focus where it is', async () => {
  const { t, visible, focused } = await tree()
  t.reveal('commerce/orders/place', { focus: false }); await settle(t)
  expect(visible()).toContain('commerce/orders/place')
  expect(focused()).toBeUndefined()
  expect([...t.shadowRoot!.querySelectorAll('[tabindex="0"]')].map(e => (e as HTMLElement).dataset.id)).toEqual(['commerce/orders/place'])
})

test('while filtering, ← goes to the parent (rows can\'t be closed then)', async () => {
  const { t, key, focused } = await tree()
  t.query = 'refund'; await settle(t)
  t.reveal('billing/payments'); await settle(t)   // open, as everything is while filtering
  await key('ArrowLeft'); expect(focused()).toBe('billing')
})
