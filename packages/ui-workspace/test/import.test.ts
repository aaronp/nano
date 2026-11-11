// Importing a package from its manifest URL: what is loaded and added, what is refused (and adds nothing), and start-up.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'

await import('../src/boot-theme.ts')   // as main.ts does first: the theme is on <html> before any element upgrades
const page = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
document.body.innerHTML = page.slice(page.indexOf('<body>') + 6, page.indexOf('</body>'))
const { catalog } = await import('../src/composable.ts')
const { loadPackage, bootImports } = await import('../src/imports.ts')
const { importsStore } = await import('../src/lib/imports.ts')

const loadTrusted = (u: string, d: Parameters<typeof loadPackage>[1]) => loadPackage(u, d, 'trusted')
const fixture = new URL('./fixtures/pkg/index.ts', import.meta.url).href
const manifest = (over: object = {}) => ({ manifest: 1, name: 'fixture-pkg', version: '0.1.0', module: './index.js',
  shared: { '@pritzlaff/nano-runes': '^0.1.0' }, components: [{ kind: 'clock', id: 'fixture.pkg/clock', title: 'Clock', tag: 'fixture-clock' }], ...over })
/** A web of manifests by URL; every module URL is the fixture package (or missing). */
const web = (manifests: Record<string, unknown>, modules: Record<string, string> = {}, probes: Record<string, unknown> = {}) => ({
  probe: async (u: string) => { if (!(u in probes)) return { error: 'probe failed: ' + u }; return probes[u] as never },
  fetchJson: async (u: string) => { if (!(u in manifests)) throw new Error('404 Not Found'); return manifests[u] },
  importModule: async (u: string) => { if (!(u in modules)) throw new Error('Failed to fetch module ' + u); return import(modules[u]!) },
})

test('a bad manifest, a missing module, a clash and a catalog mismatch are refused, and add nothing', async () => {
  const before = Object.keys(catalog).length
  expect(await loadTrusted('https://a/m.json', web({ 'https://a/m.json': { manifest: 2 } }))).toHaveProperty('error')
  expect(await loadTrusted('https://a/m.json', web({ 'https://a/m.json': manifest() }))).toHaveProperty('error')   // module 404
  const clash = await loadTrusted('https://a/m.json', web({ 'https://a/m.json': manifest({ components: [{ kind: 'range', id: 'x/range', title: 'R' }] }) }))
  expect((clash as { error: string }).error).toContain('range')
  const mismatch = await loadTrusted('https://a/m.json', web({ 'https://a/m.json': manifest({ components: [{ kind: 'clock', id: 'fixture.pkg/clock', title: 'Clock', tag: 'other-tag' }] }) }, { 'https://a/index.js': fixture }))
  expect((mismatch as { error: string }).error).toContain('other-tag')
  expect(Object.keys(catalog).length).toBe(before)
  expect(customElements.get('fixture-clock')).toBeUndefined()
})

test('a good package is loaded, defined and added to the host', async () => {
  const r = await loadTrusted('https://pkg.example/dist/manifest.json', web({ 'https://pkg.example/dist/manifest.json': manifest() }, { 'https://pkg.example/dist/index.js': fixture }))
  expect(r).not.toHaveProperty('error')
  expect(catalog.clock!.title).toBe('Clock')
  expect(customElements.get('fixture-clock')).toBeDefined()
  expect(document.querySelector('workspace-dock#workspace > template[data-widget="clock"]')!.getAttribute('data-package')).toBe('fixture-pkg')
  const again = await loadTrusted('https://pkg.example/dist/manifest.json', web({ 'https://pkg.example/dist/manifest.json': manifest() }, { 'https://pkg.example/dist/index.js': fixture }))
  expect((again as { error: string }).error).toContain('clock')   // already loaded
})

test('start-up loads remembered imports; one that fails is reported, and the rest still load', async () => {
  localStorage.clear()
  const store = importsStore(localStorage)
  store.put({ url: 'https://dead/m.json', name: 'dead', version: '1.0.0' })
  store.put({ url: 'https://ok/m.json', name: 'ok', version: '0.1.0' })
  const failed: unknown[] = []
  document.addEventListener('imports:failed', e => failed.push(...(e as CustomEvent<unknown[]>).detail))
  const m = manifest({ name: 'ok', components: [{ kind: 'stopwatch', id: 'fixture.pkg/clock', title: 'Clock', tag: 'fixture-clock' }] })
  await bootImports(web({ 'https://ok/m.json': m }, {}))
  expect(failed.map(f => (f as { url: string }).url)).toEqual(['https://dead/m.json', 'https://ok/m.json'])   // ok's names are taken now
  document.dispatchEvent(new CustomEvent('imports:remove', { detail: { url: 'https://dead/m.json', name: 'dead' } }))
  expect(store.list().map(r => r.name)).toEqual(['ok'])
})

test('the dialog: fetch shows the preview (components, ops, shared versions); a clash disables Import; Import adds and remembers', async () => {
  const { openImportDialog } = await import('../src/components/import-dialog.ts')
  localStorage.clear()
  const tick = () => new Promise(r => setTimeout(r, 0))
  const versions = './shared/versions.json'   // fetched relative to the page
  const m2 = manifest({ name: 'dials', components: [{ kind: 'dial', id: 'fixture.pkg2/dial', title: 'Dial', tag: 'fixture-dial', ops: [{ name: 'tick', input: true, output: true }] }] })
  const deps = web({ [versions]: { '@pritzlaff/nano-runes': '0.1.0' }, 'https://d/m.json': m2, 'https://c/m.json': manifest() },
    { 'https://d/index.js': new URL('./fixtures/pkg2/index.ts', import.meta.url).href })
  const dialog = () => document.querySelector('dialog[aria-label="Import components"]') as HTMLDialogElement
  const $ = (sel: string) => dialog().querySelector(sel) as HTMLElement
  const fetchUrl = async (u: string) => { ($('input[name="url"]') as HTMLInputElement).value = u; $('[data-fetch]').click(); for (let i = 0; i < 4; i++) await tick() }

  openImportDialog(document, deps)
  await fetchUrl('https://c/m.json')   // fixture-pkg is loaded already
  expect(($('[data-import]') as HTMLButtonElement).disabled).toBe(true)
  expect($('[role="alert"]').textContent).toContain('clock')
  await fetchUrl('https://d/m.json')
  const preview = $('.preview').textContent!
  expect(preview).toContain('dials 0.1.0')
  expect(preview).toContain('Dial')
  expect(preview).toContain('fixture.pkg2/dial')
  expect(preview).toContain('tick')
  expect(preview).toContain('✓ @pritzlaff/nano-runes')
  expect(($('[data-import]') as HTMLButtonElement).disabled).toBe(false)
  expect(($('input[name="trust"]:checked') as HTMLInputElement).value).toBe('sandboxed')   // the default
  $('input[name="trust"][value="trusted"]').click()
  $('[data-import]').click(); for (let i = 0; i < 6; i++) await tick()
  expect(catalog.dial!.title).toBe('Dial')
  expect(importsStore(localStorage).list()).toEqual([{ url: 'https://d/m.json', name: 'dials', version: '0.1.0', trust: 'trusted' }])
  expect(dialog()).toBeNull()
})

// ---- sandboxed imports
const op = (name: string) => ({ ns: 'fixture.pkg', name })
const probed = (over: object = {}) => ({ sbx: { id: { ns: 'fixture.pkg', name: 'sbx' }, title: 'Sbx', tag: 'fixture-sbx', ops: [op('go')], ...over } })
const sbxManifest = (over: object = {}) => manifest({ name: 'sbx-pkg', components: [{ kind: 'sbx', id: 'fixture.pkg/sbx', title: 'Sbx', tag: 'fixture-sbx' }], ...over })
const noImport = (manifests: Record<string, unknown>, probes: Record<string, unknown>) => {
  const imported: string[] = []
  return { imported, deps: { ...web(manifests, {}, probes), importModule: async (u: string) => { imported.push(u); throw new Error('host imported ' + u) } } }
}

test('a sandboxed import never calls importModule, and adds kinds whose modes are isolated-sandbox only', async () => {
  const { imported, deps } = noImport({ 'https://s/m.json': sbxManifest() }, { 'https://s/index.js': probed() })
  const r = await loadPackage('https://s/m.json', deps)   // sandboxed is the default
  expect(r).not.toHaveProperty('error')
  expect(imported).toEqual([])
  expect(catalog.sbx!.modes).toEqual(['isolated-sandbox'])
  expect(catalog.sbx!.trust).toBe('sandboxed')
  expect(catalog.sbx!.source).toEqual({ url: 'https://s/index.js' })
  expect(catalog.sbx!.component.id).toEqual({ ns: 'fixture.pkg', name: 'sbx' })
  expect(customElements.get('fixture-sbx')).toBeUndefined()
})

test('a sandboxed kind\'s dock template is <c-sandboxed keep>', () => {
  const t = document.querySelector('workspace-dock#workspace > template[data-widget="sbx"]') as HTMLTemplateElement
  expect(t.innerHTML).toBe('<c-sandboxed keep="" kind="sbx" mode="isolated-sandbox"></c-sandboxed>')
})

test('a sandboxed import whose probe fails (404, CORS, no catalog, malformed entry) adds nothing and says why', async () => {
  const before = Object.keys(catalog).length
  const m = () => ({ 'https://f/m.json': sbxManifest({ name: 'f-pkg', components: [{ kind: 'fbx', id: 'fixture.pkg/fbx', title: 'F', tag: 'fixture-fbx' }] }) })
  const fails = { error: 'CORS blocked https://f/index.js' }
  for (const [probe, why] of [[fails, 'CORS'], [probed({ id: 'nope' }), 'id'], [{ fbx: { ...probed().sbx, id: { ns: 'fixture.pkg', name: 'fbx' }, ops: [{ ns: 'x', name: 'a/b' }] } }, 'op name']] as const) {
    const { deps, imported } = noImport(m(), { 'https://f/index.js': probe })
    const r = await loadPackage('https://f/m.json', deps)
    expect((r as { error: string }).error).toContain(why)
    expect(imported).toEqual([])
  }
  expect(await loadPackage('https://f/m.json', noImport(m(), {}).deps)).toHaveProperty('error')   // probe 404
  expect(Object.keys(catalog).length).toBe(before)
})

test('the manifest-vs-catalog check applies to probed entries', async () => {
  const m = { 'https://g/m.json': sbxManifest({ name: 'g-pkg', components: [{ kind: 'gbx', id: 'fixture.pkg/gbx', title: 'G', tag: 'fixture-gbx' }] }) }
  const wrongTag = { gbx: { id: { ns: 'fixture.pkg', name: 'gbx' }, title: 'G', tag: 'other-tag', ops: [] } }
  expect(((await loadPackage('https://g/m.json', noImport(m, { 'https://g/index.js': wrongTag }).deps)) as { error: string }).error).toContain('other-tag')
  expect(((await loadPackage('https://g/m.json', noImport(m, { 'https://g/index.js': {} }).deps)) as { error: string }).error).toContain('gbx')
  expect(catalog.gbx).toBeUndefined()
})

test('the record keeps its trust; boot re-imports with it; a record without trust is trusted', async () => {
  localStorage.clear()
  const store = importsStore(localStorage)
  store.put({ url: 'https://b1/m.json', name: 'b1', version: '0.1.0', trust: 'sandboxed' })
  store.put({ url: 'https://b2/m.json', name: 'b2', version: '0.1.0' })
  expect(store.list()[0]!.trust).toBe('sandboxed')
  const b1 = sbxManifest({ name: 'b1', components: [{ kind: 'bsbx', id: 'fixture.pkg/bsbx', title: 'B', tag: 'fixture-bsbx' }] })
  const b2 = manifest({ name: 'b2', components: [{ kind: 'btr', id: 'fixture.pkg/btr', title: 'Clock', tag: 'fixture-btr' }] })
  const imported: string[] = [], probed2: string[] = []
  await bootImports({
    fetchJson: async u => ({ 'https://b1/m.json': b1, 'https://b2/m.json': b2 } as Record<string, unknown>)[u],
    probe: async u => { probed2.push(u); return { bsbx: { id: { ns: 'fixture.pkg', name: 'bsbx' }, title: 'B', tag: 'fixture-bsbx', ops: [] } } },
    importModule: async u => { imported.push(u); throw new Error('x') },
  })
  expect(probed2).toEqual(['https://b1/index.js'])
  expect(imported).toEqual(['https://b2/index.js'])   // the trusted one was imported (and failed here), never the sandboxed one
  expect(catalog.bsbx!.trust).toBe('sandboxed')
})

test('a forged probe entry (extra component.id) is refused: the id checked is the one the stand-in uses', async () => {
  const m = { 'https://h/m.json': sbxManifest({ name: 'h-pkg', components: [{ kind: 'hbx', id: 'fixture.pkg/hbx', title: 'H', tag: 'fixture-hbx' }] }) }
  const forged = { hbx: { id: { ns: 'evil', name: 'x' }, component: { id: { ns: 'fixture.pkg', name: 'hbx' } }, title: 'H', tag: 'fixture-hbx', ops: [] } }
  expect(((await loadPackage('https://h/m.json', noImport(m, { 'https://h/index.js': forged }).deps)) as { error: string }).error).toContain('evil/x')
  expect(catalog.hbx).toBeUndefined()
})

test('an unknown trust is sandboxed, not trusted', async () => {
  const { imported, deps } = noImport({ 'https://i/m.json': sbxManifest({ name: 'i-pkg', components: [{ kind: 'ibx', id: 'fixture.pkg/ibx', title: 'I', tag: 'fixture-ibx' }] }) }, { 'https://i/index.js': { ibx: { id: { ns: 'fixture.pkg', name: 'ibx' }, title: 'I', tag: 'fixture-ibx', ops: [] } } })
  await loadPackage('https://i/m.json', deps, 'x' as never)
  expect(imported).toEqual([])
  expect(catalog.ibx!.trust).toBe('sandboxed')
})

test('a kind named like an Object.prototype member is an error, not a crash', async () => {
  const m = { 'https://j/m.json': sbxManifest({ name: 'j-pkg', components: [{ kind: 'constructor', id: 'fixture.pkg/c', title: 'C' }] }) }
  expect(await loadPackage('https://j/m.json', noImport(m, { 'https://j/index.js': {} }).deps)).toHaveProperty('error')
  expect(await loadTrusted('https://j/m.json', web(m, { 'https://j/index.js': fixture }))).toHaveProperty('error')
})

test('two packages sharing a kind imported at once: one loads, the other is refused, nothing is overwritten', async () => {
  const pkg3 = new URL('./fixtures/pkg3/index.ts', import.meta.url).href
  const mm = (name: string) => manifest({ name, components: [{ kind: 'twin', id: 'fixture.pkg3/twin', title: 'Twin', tag: 'fixture-twin' }] })
  const d = { ...web({ 'https://p1/m.json': mm('one'), 'https://p2/m.json': mm('two') }), importModule: async () => { await new Promise(r => setTimeout(r, 20)); return import(pkg3) } }
  const results = await Promise.all([loadTrusted('https://p1/m.json', d), loadTrusted('https://p2/m.json', d)])
  expect(results.filter(r => 'error' in r)).toHaveLength(1)
  expect((results.find(r => 'error' in r) as { error: string }).error).toContain('clashes')
  expect(catalog.twin!.source).toEqual({ url: 'https://p1/index.js' })   // the first one's, not replaced
})
