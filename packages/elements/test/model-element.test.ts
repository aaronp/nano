import { expect, test } from 'bun:test'
import { html } from 'lit'
import { Type } from 'typebox'
import { Components, Registries, Runtimes } from '@composable/core'
import { component, state } from '@composable/runes'
import { ModelElement } from '../src'
const tick = () => new Promise(r => setTimeout(r, 0))

const Counter = component('test/counter', () => {
  const s = state({ count: 0 })
  return { get count() { return s.count }, add: (n: number) => { if (n < 0) throw new Error('no negatives'); s.count += n } }
}, { add: Type.Number() })

class CountEl extends ModelElement {
  render() { return html`<b>${this.read<number>(Counter.ops.count)}</b><i>${this.problem ?? ''}</i>` }
}
customElements.define('count-el', CountEl)

const mount = async () => {
  const reg = Runtimes.create(Registries.create('r')).registry
  reg.add('counter', Components.instantiate(Counter))
  const el = document.createElement('count-el') as CountEl
  el.registry = reg; el.model = 'counter'
  document.body.append(el)
  await tick(); await el.updateComplete
  const text = (sel: string) => el.shadowRoot!.querySelector(sel)!.textContent
  return { reg, el, text }
}

test('an element shows the model, and re-renders when it publishes', async () => {
  const { el, text } = await mount()
  expect(text('b')).toBe('0')
  await el.act(Counter.ops.add, 2); await tick(); await el.updateComplete
  expect(text('b')).toBe('2')
})

test('act returns a refusal, and the element shows it', async () => {
  const { el, text } = await mount()
  const r = await el.act(Counter.ops.add, -1); await el.updateComplete
  expect(r).toEqual({ error: 'no negatives' })
  expect(text('i')).toBe('no negatives')
})

test('the element is a subscriber in the registry while it is on the page, and not after', async () => {
  const { reg, el } = await mount()
  const views = () => reg.snapshot().instances.filter(i => i.id.startsWith('counter~view'))
  expect(views()).toHaveLength(1)
  expect(reg.snapshot().subscriptions.some(s => s.source === 'counter')).toBe(true)
  el.remove()
  expect(views()).toEqual([])
  expect(reg.snapshot().subscriptions.some(s => s.source === 'counter')).toBe(false)
})

test('mounting adds exactly one view', async () => {
  const reg = Runtimes.create(Registries.create('r')).registry
  reg.add('counter', Components.instantiate(Counter))
  let added = 0
  reg.listen(d => { if (d.type === 'instance-added' && d.instance.includes('~view')) added++ })
  const el = document.createElement('count-el') as CountEl
  el.registry = reg; el.model = 'counter'
  document.body.append(el)
  await tick(); await el.updateComplete
  expect(added).toBe(1)
  el.remove()
})
