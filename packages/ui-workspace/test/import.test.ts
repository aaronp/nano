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

const fixture = new URL('./fixtures/pkg/index.ts', import.meta.url).href
const manifest = (over: object = {}) => ({ manifest: 1, name: 'fixture-pkg', version: '0.1.0', module: './index.js',
  shared: { '@pritzlaff/nano-runes': '^0.1.0' }, components: [{ kind: 'clock', id: 'fixture.pkg/clock', title: 'Clock', tag: 'fixture-clock' }], ...over })
/** A web of manifests by URL; every module URL is the fixture package (or missing). */
const web = (manifests: Record<string, unknown>, modules: Record<string, string> = {}) => ({
  fetchJson: async (u: string) => { if (!(u in manifests)) throw new Error('404 Not Found'); return manifests[u] },
  importModule: async (u: string) => { if (!(u in modules)) throw new Error('Failed to fetch module ' + u); return import(modules[u]!) },
})

test('a bad manifest, a missing module, a clash and a catalog mismatch are refused, and add nothing', async () => {
  const before = Object.keys(catalog).length
  expect(await loadPackage('https://a/m.json', web({ 'https://a/m.json': { manifest: 2 } }))).toHaveProperty('error')
  expect(await loadPackage('https://a/m.json', web({ 'https://a/m.json': manifest() }))).toHaveProperty('error')   // module 404
  const clash = await loadPackage('https://a/m.json', web({ 'https://a/m.json': manifest({ components: [{ kind: 'range', id: 'x/range', title: 'R' }] }) }))
  expect((clash as { error: string }).error).toContain('range')
  const mismatch = await loadPackage('https://a/m.json', web({ 'https://a/m.json': manifest({ components: [{ kind: 'clock', id: 'fixture.pkg/clock', title: 'Clock', tag: 'other-tag' }] }) }, { 'https://a/index.js': fixture }))
  expect((mismatch as { error: string }).error).toContain('other-tag')
  expect(Object.keys(catalog).length).toBe(before)
  expect(customElements.get('fixture-clock')).toBeUndefined()
})

test('a good package is loaded, defined and added to the host', async () => {
  const r = await loadPackage('https://pkg.example/dist/manifest.json', web({ 'https://pkg.example/dist/manifest.json': manifest() }, { 'https://pkg.example/dist/index.js': fixture }))
  expect(r).not.toHaveProperty('error')
  expect(catalog.clock!.title).toBe('Clock')
  expect(customElements.get('fixture-clock')).toBeDefined()
  expect(document.querySelector('workspace-dock#workspace > template[data-widget="clock"]')!.getAttribute('data-package')).toBe('fixture-pkg')
  const again = await loadPackage('https://pkg.example/dist/manifest.json', web({ 'https://pkg.example/dist/manifest.json': manifest() }, { 'https://pkg.example/dist/index.js': fixture }))
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
  $('[data-import]').click(); for (let i = 0; i < 6; i++) await tick()
  expect(catalog.dial!.title).toBe('Dial')
  expect(importsStore(localStorage).list()).toEqual([{ url: 'https://d/m.json', name: 'dials', version: '0.1.0' }])
  expect(dialog()).toBeNull()
})
