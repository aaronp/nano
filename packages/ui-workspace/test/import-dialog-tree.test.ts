// The Import dialog (Fetch previews, Trust sets isolation, Import is the one consent); see import-dialog-setup.ts.
import { afterEach, expect, test } from 'bun:test'
import type { AppDeployment } from '@pritzlaff/nano-core'
import { template, open } from './import-dialog-setup.ts'

afterEach(() => { for (const d of document.querySelectorAll('dialog')) d.remove() })

const two = (): AppDeployment => ({
  pods: {
    todos: { implementation: 'example.todo/kv', eager: false }, todoStore: { implementation: 'example.kv/memory', eager: false },
    alice: { implementation: 'example.chat/participant', eager: false }, bob: { implementation: 'example.chat/participant', eager: false },
  },
  runtimes: {
    'example.todo.frontend': { pods: ['todos'], subscriptions: [] },
    'example.todo.backend': { pods: ['todoStore'], subscriptions: [{ kind: 'call', from: 'todos', to: 'todoStore' }] },
    'example.chat.room': { pods: ['alice', 'bob'], subscriptions: [] },
  },
  modules: { 'example.todo': 'https://other.test/t.js', 'example.kv': './kv.js', 'example.chat': './c.js' },
})
const tick = (box: HTMLInputElement, on: boolean) => { box.checked = on; box.dispatchEvent(new Event('change', { bubbles: true })) }

test('given a file, then a tree shows each runtime and its pods, all ticked', async () => {
  const t = open('http://host.test/t/nano.json', undefined, two)
  await t.fetched()
  const pods = (r: string) => [...t.d.querySelectorAll<HTMLInputElement>(`[data-runtime-of="${r}"] input[data-select-pod]`)].map(b => `${b.dataset['selectPod']} ${b.checked}`)
  expect([...t.d.querySelectorAll<HTMLInputElement>('input[data-select-runtime]')].map(b => `${b.dataset['selectRuntime']} ${b.checked}`))
    .toEqual(['example.todo.frontend true', 'example.todo.backend true', 'example.chat.room true'])
  expect(pods('example.chat.room')).toEqual(['alice true', 'bob true'])
})

test('given a runtime unticked, then its pods are; one pod ticked again makes it indeterminate', async () => {
  const t = open('http://host.test/t/nano.json', undefined, two)
  await t.fetched()
  const room = t.q<HTMLInputElement>('input[data-select-runtime="example.chat.room"]')
  tick(room, false)
  expect(t.q<HTMLInputElement>('input[data-select-pod="alice"]').checked).toBe(false)
  expect(t.q<HTMLInputElement>('input[data-select-pod="bob"]').checked).toBe(false)
  tick(t.q<HTMLInputElement>('input[data-select-pod="bob"]'), true)
  expect(room.indeterminate).toBe(true)
  tick(t.q<HTMLInputElement>('input[data-select-pod="alice"]'), true)
  expect([room.checked, room.indeterminate]).toEqual([true, false])
})

test('given todos ticked without todoStore, then a warning shows as text, and Import still imports', async () => {
  const t = open('http://host.test/t/nano.json', undefined, two)
  await t.fetched()
  tick(t.q<HTMLInputElement>('input[data-select-pod="todoStore"]'), false)
  expect(t.q('[data-pod="todos"] .warning').textContent).toContain('todos calls todoStore, which is not selected: todos will fail when it runs')
  expect(t.importButton().disabled).toBe(false)
})

test('given nothing ticked, then Import is disabled', async () => {
  const t = open('http://host.test/t/nano.json', undefined, two)
  await t.fetched()
  for (const r of t.d.querySelectorAll<HTMLInputElement>('input[data-select-runtime]')) tick(r, false)
  expect(t.importButton().disabled).toBe(true)
  tick(t.q<HTMLInputElement>('input[data-select-pod="alice"]'), true)
  expect(t.importButton().disabled).toBe(false)
})

test('given only the chat ticked, then the preview and notice show only its pods, and Import brings only them', async () => {
  const t = open('http://host.test/t/nano.json', undefined, two)
  await t.fetched()
  expect(t.q('.foreign').textContent).toContain('example.todo')
  for (const r of ['example.todo.frontend', 'example.todo.backend']) tick(t.q<HTMLInputElement>(`input[data-select-runtime="${r}"]`), false)
  expect(t.isolations()).toEqual(['alice isolated-sandbox', 'bob isolated-sandbox'])
  expect(t.q('.foreign').textContent).toBe('')   // the foreign provider is unticked: neither listed nor loaded
  t.importButton().click()
  await Promise.resolve()
  const out = t.calls[0]!.chosen!.edit(two())
  expect(Object.keys(out.pods)).toEqual(['alice', 'bob'])
  expect(Object.keys(out.runtimes)).toEqual(['example.chat.room'])
  expect(out.modules).toEqual({ 'example.chat': './c.js' })
})

test('a runtime shows the name it is imported as; its edit button opens the field, and Import takes the new name', async () => {
  const t = open('http://host.test/t/nano.json')
  await t.fetched()
  const input = t.q<HTMLInputElement>('input[data-runtime="main"]')
  expect(input.hidden).toBe(true)
  expect(t.q('[data-runtime-of="main"]').textContent).toContain('acme.template.main')
  t.q<HTMLButtonElement>('[aria-label="Rename runtime main"]').click()
  expect(input.hidden).toBe(false)
  input.value = 'mine'; input.dispatchEvent(new Event('input', { bubbles: true }))
  t.importButton().click()
  await Promise.resolve()
  expect(Object.keys(t.calls[0]!.chosen!.edit(template()).runtimes)).toEqual(['mine'])
})
