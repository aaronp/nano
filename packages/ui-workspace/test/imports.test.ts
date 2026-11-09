// Importing a package: its manifest, the shared versions it needs, clashes with what is loaded, and the record kept.
import { expect, test } from 'bun:test'
import { catalogMismatch, clashes, importsStore, parseManifest, satisfies, sharedReport } from '../src/lib/imports.ts'

const manifest = {
  manifest: 1, name: 'nano-template', version: '0.1.0', module: './index.js',
  shared: { '@pritzlaff/nano-core': '^0.1.0', lit: '^3.0.0' },
  components: [{ kind: 'timer', id: 'nano.template/timer', title: 'Timer', tag: 'nano-timer', ops: [{ name: 'start', input: true, output: true }] }],
}

test('version ranges: caret, tilde, exact, star, at-least', () => {
  expect(satisfies('0.1.5', '^0.1.0')).toBe(true)
  expect(satisfies('0.2.0', '^0.1.0')).toBe(false)
  expect(satisfies('1.9.0', '^1.4.0')).toBe(true)
  expect(satisfies('2.0.0', '^1.4.0')).toBe(false)
  expect(satisfies('1.3.9', '^1.4.0')).toBe(false)
  expect(satisfies('1.4.7', '~1.4.0')).toBe(true)
  expect(satisfies('1.5.0', '~1.4.0')).toBe(false)
  expect(satisfies('3.3.3', '3.3.3')).toBe(true)
  expect(satisfies('3.3.4', '3.3.3')).toBe(false)
  expect(satisfies('9.0.0', '*')).toBe(true)
  expect(satisfies('2.1.0', '>=2.0.0')).toBe(true)
  expect(satisfies('1.9.0', '>=2.0.0')).toBe(false)
})

test('a template-built manifest parses; anything else is refused with a reason', () => {
  expect(parseManifest(manifest)).toEqual(manifest as any)
  expect(parseManifest({ ...manifest, manifest: 2 })).toContain('version 1')
  expect(parseManifest({ ...manifest, module: undefined })).toContain('module')
  expect(parseManifest({ ...manifest, components: [{ kind: 'x' }] })).toContain('component')
  expect(parseManifest('nope')).toContain('manifest')
})

test('the shared report ticks what the host provides and warns on the rest', () => {
  expect(sharedReport(manifest as any, { '@pritzlaff/nano-core': '0.1.0', lit: '3.3.3' }).every(r => r.ok)).toBe(true)
  const r = sharedReport(manifest as any, { '@pritzlaff/nano-core': '0.2.0' })
  expect(r.map(x => [x.specifier, x.ok, x.provided])).toEqual([['@pritzlaff/nano-core', false, '0.2.0'], ['lit', false, undefined]])
})

test('clashes with what is loaded: kind, component id or element tag', () => {
  expect(clashes(manifest as any, { kinds: ['range'], ids: ['composable.bundle/range'], tags: ['c-range'] })).toEqual([])
  expect(clashes(manifest as any, { kinds: ['timer'], ids: ['nano.template/timer'], tags: ['nano-timer'] }))
    .toEqual(['kind timer', 'component nano.template/timer', 'element <nano-timer>'])
})

test('the loaded catalog must match its manifest', () => {
  const Timer = { id: { ns: 'nano.template', name: 'timer' } }
  expect(catalogMismatch(manifest as any, { timer: { component: Timer, title: 'Timer', tag: 'nano-timer' } } as any)).toBeNull()
  expect(catalogMismatch(manifest as any, {} as any)).toContain('timer')
  expect(catalogMismatch(manifest as any, { timer: { component: Timer, title: 'Timer', tag: 'other-tag' } } as any)).toContain('nano-timer')
})

test('the imports store keeps one record per URL, and forgets on remove', () => {
  const m = new Map<string, string>(), store = importsStore({ getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) } })
  store.put({ url: 'https://a/manifest.json', name: 'a', version: '0.1.0' })
  store.put({ url: 'https://a/manifest.json', name: 'a', version: '0.2.0' })
  store.put({ url: 'https://b/manifest.json', name: 'b', version: '1.0.0' })
  expect(store.list()).toEqual([{ url: 'https://a/manifest.json', name: 'a', version: '0.2.0' }, { url: 'https://b/manifest.json', name: 'b', version: '1.0.0' }])
  store.remove('https://a/manifest.json')
  expect(store.list().map(r => r.name)).toEqual(['b'])
})
