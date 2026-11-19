// Shared setup of the <nano-tree> tests: the element, a node fixture and a mounted-tree helper.
import '../src'
import { html } from 'lit'
import type { TreeNode } from '../src'

export type El = HTMLElement & { updateComplete: Promise<boolean>; [k: string]: any }
export const tick = () => new Promise(r => setTimeout(r, 0))
export const settle = async (el: El) => { for (let i = 0; i < 3; i++) { await el.updateComplete; await tick() } }

export const NODES: TreeNode[] = [
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

export const tree = async (attrs = '') => {
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
