import { Components, Systems, unwrap } from '@composable/sdk'
import { provideSystem } from '@composable/ui'
import { ComponentListOps, ConnectionEditorOps, DocumentOps, TypeEditorOps } from '../src'
import { builtins, emptyEditorDoc } from '../src/model'
import { defineEditor } from '../src/views'
import { crm, flush, mapper, tax } from './fixtures'

defineEditor()
type Host = HTMLElement & { component: any; updateComplete: Promise<boolean> }

/** A System with a provider, the fixtures (crm, map, tax) and the element, fed the fixtures as its instances. */
export const hosted = async (name: 'connection-editor' | 'component-list' | 'type-editor' | 'puzzle-editor') => {
  const s = Systems.create(), host = document.createElement('div')
  provideSystem(host, s); document.body.append(host)
  const page = unwrap(s.register('page', Components.party()))
  for (const [n, f] of [['crm', crm], ['map', mapper], ['tax', tax]] as const) unwrap(s.register(n, f.create()))
  host.innerHTML = `<${name} name="${name}"></${name}>`
  const el = host.firstElementChild as Host
  await flush(); await el.updateComplete
  const model = el.component
  const instances = s.snapshot().instances.filter(i => ['crm', 'map', 'tax'].includes(i.id))
  if (name === 'connection-editor') await page.call(name, ConnectionEditorOps.setInstances, instances)
  else if (name === 'type-editor') await page.call(name, TypeEditorOps.setTypes, builtins())
  else if (name === 'puzzle-editor') await page.call(name, DocumentOps.load, emptyEditorDoc())
  else {
    await page.call(name, ComponentListOps.setTypes, { types: builtins(), derived: [] })
    await page.call(name, ComponentListOps.setInstances, instances)
  }
  await settle(el)
  return { s, el, model }
}

const settle = async (el: Host) => { await flush(); await el.updateComplete }
const q = (el: Host, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement
const fire = (e: Element, type: string, init: MouseEventInit = {}) => e.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, ...init }))

export const click = async (el: Host, sel: string) => { q(el, sel).click(); await settle(el) }
export const type = async (el: Host, sel: string, value: string) => {
  const i = q(el, sel) as HTMLInputElement
  i.value = value; i.dispatchEvent(new Event('input', { bubbles: true })); await settle(el)
}
export const select = async (el: Host, sel: string, value: string) => {
  const i = q(el, sel) as HTMLSelectElement
  i.value = value; i.dispatchEvent(new Event('change', { bubbles: true })); await settle(el)
}
export const clickLive = async (el: Host, on: boolean) => {
  const i = q(el, '.live input') as HTMLInputElement
  i.checked = on; i.dispatchEvent(new Event('change', { bubbles: true })); await settle(el)
}
/** For `keys`, in order: dragstart that component's first palette piece, then drop it on cell (i, 0). */
export const dragRow = async (el: Host, keys: string[]) => {
  const board = q(el, '.board')
  for (const [i, key] of keys.entries()) {
    const section = [...el.shadowRoot!.querySelectorAll('.palette section')].find(s => s.querySelector('h4')!.textContent!.trim().startsWith(key))!
    fire(section.querySelector('.piece')!, 'dragstart')
    fire(board, 'drop', { clientX: i * 120 + 20, clientY: 20 }); await settle(el)
  }
}
