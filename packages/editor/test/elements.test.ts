import { expect, test } from 'bun:test'
import { Registries, Runtimes } from '@composable/core'
import { addEditor, ConnectionBoard as B, ComponentList as L, TypeList as T } from '../src'
import { defineElements } from '../src/elements'
import { seed } from '../demo/seed'
import { tick } from './fixtures'

defineElements()
type El = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot }

const settle = async (el: El) => { for (let i = 0; i < 4; i++) { await tick(); await el.updateComplete; for (const c of deep(el, '*')) await (c as El).updateComplete } }
/** Every element matching `sel`, looking inside shadow roots too. */
function deep(root: Element | ShadowRoot, sel: string): Element[] {
  const out: Element[] = []
  const walk = (n: Element | ShadowRoot) => {
    for (const e of n.querySelectorAll('*')) { if (e.matches(sel)) out.push(e); if (e.shadowRoot) walk(e.shadowRoot) }
  }
  walk('shadowRoot' in root && root.shadowRoot ? root.shadowRoot : root)
  return out
}
const button = (page: El, text: string) => deep(page, 'button').find(b => b.textContent!.trim() === text) as HTMLButtonElement

const mount = async () => {
  const rt = Runtimes.create(Registries.create('page')), ids = addEditor(rt.registry)
  await seed(rt, ids)
  const page = document.createElement('editor-page') as El & { registry: unknown; ids: unknown }
  page.registry = rt.registry; page.ids = ids
  document.body.append(page)
  await settle(page)
  const call = (id: string, op: any, arg: unknown = null) => rt.call({ registry: 'page', instance: 'test' }, id, `${op.ns}/${op.name}`, arg) as Promise<any>
  return { rt, ids, page, call }
}

test('the page shows the list, the board, and the types tab with the type editor', async () => {
  const { page } = await mount()
  expect(deep(page, 'component-list-el')).toHaveLength(1)
  expect(deep(page, 'connection-board-el')).toHaveLength(1)
  button(page, 'Types').click(); await settle(page)
  expect(deep(page, 'type-list-el')).toHaveLength(1)
  expect(deep(page, 'type-editor-el')).toHaveLength(1)
})

test('a new record type is created from the types tab', async () => {
  const { page, ids, call } = await mount()
  button(page, 'Types').click(); await settle(page)
  button(page, '+ New record type').click(); await settle(page)
  const input = deep(page, 'input[name="new-type"]')[0] as HTMLInputElement
  input.value = 'Point'; input.dispatchEvent(new Event('input'))
  button(page, 'Create').click(); await settle(page)
  expect((await call(ids.types, T.ops.types)).value.map((e: any) => e.type.title)).toContain('Point')
})

test('placing slider then doubler side by side makes one connection', async () => {
  const { page, ids, call } = await mount()
  const pick = async (component: string, op: string) => { await call(ids.list, L.ops.select, { component, op }); await settle(page) }
  const cell = (c: number) => deep(page, `[data-cell="${c},0"]`)[0] as HTMLElement
  await pick('slider', 'demo/slider/value-changed'); cell(0).click(); await settle(page)
  await pick('doubler', 'demo/doubler/map'); cell(1).click(); await settle(page)
  expect((await call(ids.board, B.ops.connections)).value).toHaveLength(1)
  expect(deep(page, '.connection')).toHaveLength(1)
})

test('an <editor-page> with no ids adds an editor to the provided registry, once', async () => {
  const { provide } = await import('@composable/elements')
  const reg = Runtimes.create(Registries.create('provided')).registry
  provide(document, reg)
  document.body.insertAdjacentHTML('beforeend', '<editor-page></editor-page><editor-page></editor-page>')
  const pages = [...document.querySelectorAll('editor-page')].slice(-2) as El[]
  for (const p of pages) await settle(p)
  expect(reg.snapshot().instances.filter(i => i.id === 'editor-list')).toHaveLength(1)
  expect(deep(pages[1]!, 'component-list-el')).toHaveLength(1)
})
