/** `Registry.load`: a document's modules as a registry, with their exports. */
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Application, Registry, success } from '../src/index.ts'

const base = new URL('./fixtures/', import.meta.url)

test('exports carries each module namespace; providers are in the registry', async () => {
  const r = await Registry.load({ v: './mod-views.js', o: './mod-other.js' }, base)
  if (!r.ok) throw new Error(r.fail.reason)
  expect(r.value.exports.v?.views).toEqual({ main: 'ui' })
  expect(r.value.registry.provider('acme.views')).toBeDefined()
  expect(r.value.registry.provider('acme.other')).toBeDefined()
})

test('a bad module fails with the right type', async () => {
  for (const [m, type] of [['throws', 'not-found'], ['missing', 'not-found'], ['nodefault', 'invalid-input'], ['notprovider', 'invalid-input'], ['empty', 'invalid-input']] as const) {
    const r = await Registry.load({ m: `./mod-${m}.js` }, base)
    expect(r.ok ? 'ok' : r.fail.type).toBe(type)
  }
})

test('a refused add fails invalid-input', async () => {
  const r = await Registry.load({ a: './mod-other.js', b: './mod-other.js' }, base)
  expect(r.ok ? 'ok' : r.fail.type).toBe('invalid-input')
})

test('a failure part-way through is the whole result, with no value', async () => {
  const r = await Registry.load({ a: './mod-other.js', b: './mod-nodefault.js' }, base)
  expect(r.ok).toBe(false)
  expect('value' in r).toBe(false)
})

test('Application.load runs a pod from a module named by a relative path; without the module it fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nano-rl-'))
  try {
    const doc = (modules: Record<string, string>) => ({ pods: { p: { implementation: 'acme/ping', eager: false } }, runtimes: { main: { pods: ['p'], subscriptions: [] } }, modules })
    const real = relative(dir, fileURLToPath(new URL('./fixtures/mod-real.ts', import.meta.url)))   // relative to the document
    writeFileSync(join(dir, 'with.json'), JSON.stringify(doc({ m: real })))
    writeFileSync(join(dir, 'without.json'), JSON.stringify(doc({})))
    expect(await Application.load(pathToFileURL(join(dir, 'with.json'))).then(a => a.call('main', 'p').ping(null))).toEqual(success('pong'))
    expect(await Application.load(pathToFileURL(join(dir, 'without.json'))).catch((e: Error) => e.message)).toContain('acme/ping')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
