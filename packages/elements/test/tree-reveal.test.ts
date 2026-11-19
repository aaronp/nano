// <nano-tree>: nodes in a tree; see tree-setup.ts.
import { expect, test } from 'bun:test'
import { html } from 'lit'
import type { TreeNode } from '../src'
import { settle, tree } from './tree-setup.ts'

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

test('a node\'s data is carried as data-* on its row', async () => {
  const { t, item } = await tree()
  t.nodes = [{ id: 'a', label: 'A', data: { deploy: 'sandbox', mark: '' } }, { id: 'b', label: 'B' }]; await settle(t)
  expect(item('a')!.dataset.deploy).toBe('sandbox')
  expect(item('a')!.hasAttribute('data-mark')).toBe(true)
  expect(Object.keys(item('b')!.dataset).sort()).toEqual(['id'])
  t.nodes = [{ id: 'a', label: 'A', data: { deploy: 'host' } }, { id: 'b', label: 'B' }]; await settle(t)
  expect(item('a')!.hasAttribute('data-mark')).toBe(false)   // gone from the data, gone from the row
})

test('a data key that is not a valid attribute name is skipped, not thrown on', async () => {
  const { t, item } = await tree()
  t.nodes = [{ id: 'a', label: 'A', data: { 'bad key': 'x', 'a=b': 'y', ok: 'z' } }]; await settle(t)
  expect(item('a')!.dataset.ok).toBe('z')
  expect(item('a')!.getAttributeNames().filter(n => n.startsWith('data-')).sort()).toEqual(['data-id', 'data-ok'])
})

test('with icon, a node shows it and hides the kind word (kept as title); without, unchanged', async () => {
  const { t, $ } = await tree('open-depth="1"')
  const line = () => $('[data-id="analytics"] > .line')!
  expect(line().querySelector('.kind')?.textContent).toBe('system')
  expect(line().querySelector('.icon')).toBeNull()
  t.icon = (n: TreeNode) => n.kind === 'system' ? html`<i class="ic">*</i>` : undefined; await settle(t)
  expect(line().querySelector('.icon .ic')).not.toBeNull()
  expect(line().querySelector('.icon')!.getAttribute('title')).toBe('system')
  expect(line().querySelector('.kind')).toBeNull()
  expect($('[data-id="commerce/payments"] > .line .kind')?.textContent).toBe('component')
})
