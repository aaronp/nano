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
function open(url: string, known = (_: string) => false) {
  const calls: { url: string; chosen?: Chosen }[] = []
  const d = openImportDialog(document, {
    fetchJson: async () => template(), known,
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
