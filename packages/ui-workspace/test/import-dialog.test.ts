// The Import dialog: Fetch previews the file's runtimes (each with a name to import it as), its pods with the isolation
// Trust gives them, and which providers come from another origin; Import is the one consent.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: 'http://host.test/' })
import { afterEach, expect, test } from 'bun:test'
import type { AppDeployment } from '@pritzlaff/nano-core'
const { openImportDialog } = await import('../src/components/import-dialog.ts')   // after happy-dom: it listens on document

const template = (): AppDeployment => ({
  pods: {
    timer: { implementation: 'acme.template/timer', eager: false },
    picker: { implementation: 'acme.template/picker', eager: false },
    store: { implementation: 'acme.template/store', eager: false, isolation: 'isolated-sandbox' },
  },
  runtimes: { main: { pods: ['timer', 'picker', 'store'], subscriptions: [] } },
  modules: { 'acme.template': './index.js' },
})

type Chosen = { edit(d: AppDeployment): AppDeployment }
function open(url: string, known = (_: string) => false, file = template) {
  const calls: { url: string; chosen?: Chosen }[] = []
  const d = openImportDialog(document, {
    fetchJson: async () => file(), known,
    importUrl: async (u: string, chosen?: Chosen) => { calls.push({ url: u, ...(chosen && { chosen }) }); return { ok: true } },
  })
  const q = <T extends Element>(s: string) => d.querySelector(s) as T
  const fetched = async () => {
    q<HTMLInputElement>('input[name="url"]').value = url
    q<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true }))
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }
  const isolations = () => [...d.querySelectorAll('[data-pod]')].map(li => `${li.getAttribute('data-pod')} ${li.querySelector('[data-isolation]')!.textContent}`)
  const importButton = () => q<HTMLButtonElement>('[data-import]')
  const choose = (v: string) => { const r = q<HTMLInputElement>(`input[name="trust"][value="${v}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })) }
  return { d, q, calls, fetched, isolations, importButton, choose }
}
afterEach(() => { for (const d of document.querySelectorAll('dialog')) d.remove() })

test('given the template, then its runtime is suggested as acme.template.main', async () => {
  const t = open('http://host.test/t/nano.json')
  await t.fetched()
  expect(t.q<HTMLInputElement>('input[data-runtime="main"]').value).toBe('acme.template.main')
})

test('given Trust, then each pod shows its isolation live, and Import applies it and the runtime name', async () => {
  const t = open('http://host.test/t/nano.json')
  await t.fetched()
  expect(t.isolations()).toEqual(['timer isolated-sandbox', 'picker isolated-sandbox', 'store isolated-sandbox'])
  t.choose('trusted')
  expect(t.isolations()).toEqual(['timer host', 'picker host', 'store isolated-sandbox'])   // never loosens the file's own
  t.importButton().click()
  await Promise.resolve()
  const out = t.calls[0]!.chosen!.edit(template())
  expect(Object.keys(out.runtimes)).toEqual(['acme.template.main'])
  expect(Object.values(out.pods).map(p => p.isolation ?? 'host')).toEqual(['host', 'host', 'isolated-sandbox'])
})

test('given a file from another origin, then the notice is inline, as text, and Import asks nothing more', async () => {
  const t = open('https://other.test/t/nano.json')
  await t.fetched()
  const notice = t.q<HTMLElement>('.foreign')
  expect(notice.textContent).toContain('acme.template')
  expect(notice.textContent).toContain('https://other.test')
  expect(notice.querySelectorAll('strong').length).toBe(0)   // Sandboxed: nothing runs with full access
  t.choose('trusted')
  expect([...t.q<HTMLElement>('.foreign').querySelectorAll('strong')].length).toBe(2)   // timer, picker: host
  t.importButton().click()
  await Promise.resolve()
  expect(t.calls.length).toBe(1)
  expect(t.calls[0]!.chosen).toBeDefined()   // the dialog's choice: the host does not confirm again
  expect(document.querySelectorAll('dialog').length).toBe(0)
})

test('given an invalid runtime name, then Import is disabled with a message, and enabled again once valid', async () => {
  const t = open('http://host.test/t/nano.json')
  await t.fetched()
  const name = t.q<HTMLInputElement>('input[data-runtime="main"]')
  for (const bad of ['', 'a b', 'a/b', 'a#b']) {
    name.value = bad; name.dispatchEvent(new Event('input', { bubbles: true }))
    expect(t.importButton().disabled).toBe(true)
    expect(t.q('[role="alert"]').textContent).not.toBe('')
  }
  name.value = 'mine'; name.dispatchEvent(new Event('input', { bubbles: true }))
  expect(t.importButton().disabled).toBe(false)
})

test('given a provider the workspace already has, then its pods keep the file\'s isolation and the runtime its name', async () => {
  const t = open('http://host.test/t/nano.json', c => c === 'acme.template')
  await t.fetched()
  expect(t.q<HTMLInputElement>('input[data-runtime="main"]').value).toBe('main')
  expect(t.isolations()).toEqual(['timer host', 'picker host', 'store isolated-sandbox'])
})

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
  expect(t.q('.warnings').textContent).toContain('todos calls todoStore, which is not selected: todos will fail when it runs')
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
