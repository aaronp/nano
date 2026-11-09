import { expect, test } from 'bun:test'
import { html } from 'lit'
import { Components, Registries, Runtimes } from '@composable/core'
import { component, state } from '@composable/runes'
import { PlacedElement, provide } from '../src'

const tick = () => new Promise(r => setTimeout(r, 0))
const Note = component('test/note', () => { const s = state({ text: 'hi' }); return { get text() { return s.text }, set: (t: string) => { s.text = t } } })
class NoteEl extends PlacedElement {
  static component = Note
  render() { return html`<p>${this.read<string>(Note.ops.text)}</p>` }
}
customElements.define('note-el', NoteEl)

const reg = Runtimes.create(Registries.create('page')).registry
provide(document, reg)
const ids = () => reg.snapshot().instances.map(i => i.id).filter(i => !i.includes('~view') && i !== 'registry')
const place = async (name?: string, parent: Element = document.body) => {
  const el = document.createElement('note-el') as NoteEl
  if (name) el.setAttribute('name', name)
  parent.append(el); await tick(); await el.updateComplete
  return el
}

test('placing an element creates its instance; removing it removes the instance', async () => {
  const el = await place('a')
  expect(ids()).toContain('a')
  expect(el.shadowRoot!.querySelector('p')!.textContent).toBe('hi')
  el.remove(); await tick()
  expect(ids()).not.toContain('a')
})

test('an existing instance is attached to and left in place; two elements can share it', async () => {
  reg.add('shared', Components.instantiate(Note))
  const one = await place('shared'), two = await place('shared')
  one.remove(); two.remove(); await tick()
  expect(ids()).toContain('shared')
  reg.remove('shared')
})

test('moving an element keeps its instance', async () => {
  const el = await place('moved'), box = document.createElement('div')
  document.body.append(box)
  box.append(el); await tick(); await el.updateComplete
  expect(ids()).toContain('moved')
  el.remove(); await tick()
  expect(ids()).not.toContain('moved')
})

test('without a name, an element gets a generated one', async () => {
  const el = await place()
  expect(ids().some(i => i.startsWith('note-el-'))).toBe(true)
  el.remove(); await tick()
  expect(ids().some(i => i.startsWith('note-el-'))).toBe(false)
})
