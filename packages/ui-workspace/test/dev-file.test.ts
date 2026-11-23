import './wires/dom.ts'
import { expect, test } from 'bun:test'
import { devFile, onRebuild, openDevFile, restoreModules, saveTo } from '../src/dev-file.ts'

test('devFile reads the meta', () => {
  expect(devFile(document)).toBeUndefined()
  document.head.innerHTML = '<meta name="nano-app-file" content="/nano.json">'
  expect(devFile(document)).toBe('/nano.json')
  document.head.innerHTML = ''
})

test('restoreModules: the original\'s entries back, top level or under app; new keys and the rest as saved', () => {
  const orig = { modules: { a: './index.js' }, app: { modules: { b: './b.js' } } }
  const saved = { x: 1, modules: { a: 'http://h/index.js', n: 'http://h/n.js' }, app: { modules: { b: 'http://h/b.js' }, y: 2 } }
  expect(restoreModules(saved, orig)).toEqual({ x: 1, modules: { a: './index.js', n: 'http://h/n.js' }, app: { modules: { b: './b.js' }, y: 2 } })
})

test('saveTo PUTs the exact body; a 403 is a failure', async () => {
  let seen: [unknown, RequestInit | undefined] | undefined
  const ok = (async (u: unknown, i?: RequestInit) => { seen = [u, i]; return new Response('', { status: 200 }) }) as unknown as typeof fetch
  expect((await saveTo('/nano.json', { a: 1 }, ok)).ok).toBe(true)
  expect(seen![0]).toBe('/nano.json'); expect(seen![1]!.method).toBe('PUT'); expect(seen![1]!.body).toBe('{\n  "a": 1\n}\n')
  const no = (async () => new Response('', { status: 403, statusText: 'Forbidden' })) as unknown as typeof fetch
  const r = await saveTo('/nano.json', {}, no)
  expect(!r.ok && r.fail.reason).toContain('403 Forbidden')
})

test('onRebuild: reloads when clean; the notice when dirty (Reload reloads, Later removes it)', () => {
  let fire = (_: string) => {}, reloads = 0, dirty = false
  onRebuild(document, () => dirty, () => { reloads++ }, { addEventListener: (_t, fn) => { fire = data => fn({ data }) } })
  fire('rebuilt'); expect(reloads).toBe(1)
  dirty = true; fire('rebuilt')
  const note = document.querySelector('[role="status"]')!
  expect(note.textContent).toContain('Rebuilt — Reload (unsaved changes are lost)')
  const [reload, later] = [...note.querySelectorAll('button')]
  reload!.click(); expect(reloads).toBe(2)
  later!.click(); expect(document.querySelector('[role="status"]')).toBeNull()
})

test('openDevFile: dirty is "Save would write something else than after the import"; the import and a Save leave it clean', async () => {
  ;(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL('http://localhost/')
  const real = globalThis.fetch, puts: string[] = []
  globalThis.fetch = (async (_u: unknown, i?: RequestInit) => { if (i?.method === 'PUT') { puts.push(String(i.body)); return new Response('') } return new Response('{"modules":{"a":"./index.js"}}') }) as unknown as typeof fetch
  try {
    let layout = 1, fire = (_: string) => {}, reloads = 0
    const menu = { dirty: true }, imported = { n: 0 }
    const save = await openDevFile('/nano.json', { importUrl: async () => { layout = 2; imported.n++; return { ok: true, value: undefined } } },
      () => ({ layout, modules: { a: 'http://h/index.js' } }), menu, () => { reloads++ }, { addEventListener: (_t, fn) => { fire = data => fn({ data }) } })
    expect(imported.n).toBe(1); expect(menu.dirty).toBe(false)
    fire('rebuilt'); expect(reloads).toBe(1)
    layout = 3; fire('rebuilt'); expect(reloads).toBe(1); expect(document.querySelector('[role="status"]')).not.toBeNull()
    document.querySelector('[role="status"]')!.remove()
    await save(); expect(puts[0]).toContain('"./index.js"'); expect(puts[0]).toContain('"layout": 3')
    fire('rebuilt'); expect(reloads).toBe(2)
  } finally { globalThis.fetch = real }
})

test('openDevFile: a missing file is a toast, not a throw, and rebuilds are still watched', async () => {
  const real = globalThis.fetch
  globalThis.fetch = (async () => new Response('nope', { status: 404, statusText: 'Not Found' })) as unknown as typeof fetch
  try {
    let fire = (_: string) => {}, reloads = 0, imported = false
    await openDevFile('/nano.json', { importUrl: async () => { imported = true; return { ok: true, value: undefined } } }, () => ({}), undefined, () => { reloads++ }, { addEventListener: (_t, fn) => { fire = data => fn({ data }) } })
    expect(imported).toBe(false); fire('rebuilt'); expect(reloads).toBe(1)
  } finally { globalThis.fetch = real }
})
