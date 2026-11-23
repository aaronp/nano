// The Import dialog (Fetch previews, Trust sets isolation, Import is the one consent); see import-dialog-setup.ts.
import { afterEach, expect, test } from 'bun:test'
import { template, open } from './import-dialog-setup.ts'

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

test('given a provider coordinate with a slash (acme/mem), then the notice flags the pods the import would run with full access', async () => {
  const file = () => ({ pods: { db: { implementation: 'acme/mem/db', eager: false } },
    runtimes: { main: { pods: ['db'], subscriptions: [] } }, modules: { 'acme/mem': './mem.js' } })
  const t = open('https://other.test/t/nano.json', undefined, file)
  await t.fetched()
  t.choose('trusted')
  expect([...t.q<HTMLElement>('.foreign').querySelectorAll('strong')].map(s => s.textContent)).toEqual(['db'])
})

test('given an import that fails, then its reason shows inside the dialog and Import is enabled again', async () => {
  const { failure } = await import('@pritzlaff/nano-core')
  const { openImportDialog } = await import('../src/components/import-dialog.ts')
  const d = openImportDialog(document, { fetchJson: async () => template(), known: () => false, importUrl: async () => failure('invalid-input', 'a malformed message: nope') })
  d.querySelector<HTMLInputElement>('input[name="url"]')!.value = 'http://host.test/t/nano.json'
  d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  for (let i = 0; i < 5; i++) await Promise.resolve()
  d.querySelector<HTMLButtonElement>('[data-import]')!.click()
  for (let i = 0; i < 5; i++) await Promise.resolve()
  expect(d.querySelector('[role="alert"]')!.textContent).toContain('a malformed message: nope')
  expect(d.querySelector<HTMLButtonElement>('[data-import]')!.disabled).toBe(false)
})
