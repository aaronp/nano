/** `Registry.load`: a document's modules as a registry, with their exports. */
import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Application, Registry } from '../src/index.ts'

const base = new URL('./fixtures/', import.meta.url)

test('exports carries each module namespace; providers are in the registry', async () => {
  const r = await Registry.load({ v: './mod-views.js', o: './mod-other.js' }, base)
  if (!r.ok) throw new Error(r.fail.reason)
  expect(r.value.exports.v?.views).toEqual({ main: 'ui' })
  expect(r.value.registry.provider('acme.views')).toBeDefined()
  expect(r.value.registry.provider('acme.other')).toBeDefined()
})

test('a bad module fails with the right type', async () => {
  for (const [m, type] of [['throws', 'not-found'], ['missing', 'not-found'], ['nodefault', 'invalid-input'], ['notprovider', 'invalid-input']] as const) {
    const r = await Registry.load({ m: `./mod-${m}.js` }, base)
    expect(r.ok ? 'ok' : r.fail.type).toBe(type)
  }
})

test('a refused add fails invalid-input', async () => {
  const r = await Registry.load({ a: './mod-other.js', b: './mod-other.js' }, base)
  expect(r.ok ? 'ok' : r.fail.type).toBe('invalid-input')
})

test('Application.load resolves a relative module path against the document', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nano-rl-'))
  writeFileSync(join(dir, 'mod.js'), 'export default { coord: "acme.rel", implementations: new Map(), meta: {} }')
  writeFileSync(join(dir, 'nano.json'), JSON.stringify({ pods: {}, runtimes: {}, modules: { m: './mod.js' } }))
  const app = await Application.load(pathToFileURL(join(dir, 'nano.json')))
  expect(app).toBeDefined()
})
