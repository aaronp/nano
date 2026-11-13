import { expect, test } from 'bun:test'
import { Ops, Registries, Runtimes } from '@pritzlaff/nano-core'
import { provide } from '@pritzlaff/nano-elements'
import { definePeople, MemoryDb } from '../src'

definePeople()
const rt = Runtimes.create(Registries.create('page'))
provide(document, rt.registry)
type El = HTMLElement & { updateComplete: Promise<boolean> }
const settle = async (el: El) => { for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); await el.updateComplete } }

test('c-people-db shows a row per entry', async () => {
  document.body.insertAdjacentHTML('beforeend', '<c-people-db name="db"></c-people-db>')
  const el = document.body.lastElementChild as El
  await settle(el)
  await rt.call({ registry: 'page', instance: 't' }, 'db', Ops.key(MemoryDb.ops.save), { key: 'p1', value: { name: 'Ada' } })
  await settle(el)
  expect([...el.shadowRoot!.querySelectorAll('tbody tr')].map(r => r.textContent)).toEqual(['p1{"name":"Ada"}'])
})

test('c-person-form renders its form, and an unbound need shows as a problem', async () => {
  document.body.insertAdjacentHTML('beforeend', '<c-person-form name="form"></c-person-form>')
  const el = document.body.lastElementChild as El & { problem?: string }
  await settle(el)
  expect(el.shadowRoot!.querySelectorAll('form input').length).toBe(3)
  expect(el.problem).toBe('form needs bff: not bound')
})
