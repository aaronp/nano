// The build: a module that leaves the shared packages to the host, its manifest, and the preview page.
import { expect, test } from 'bun:test'
import { $ } from 'bun'
import { join } from 'node:path'
import { SHARED_IMPORTS } from '../src/manifest'

const dist = join(import.meta.dir, '..', 'dist')

test('the build writes the module, manifest and preview; the module carries no copy of the shared packages', async () => {
  await $`bun scripts/build.ts`.cwd(join(import.meta.dir, '..')).quiet()
  const js = await Bun.file(join(dist, 'index.js')).text()
  for (const p of ['@pritzlaff/nano-runes', '@pritzlaff/nano-elements', 'lit', 'typebox']) expect(js).toMatch(new RegExp(`from"${p}"`))
  expect(js).not.toContain('ReactiveElement')
  expect(js).not.toContain('TypeBox')
  const manifest = await Bun.file(join(dist, 'manifest.json')).json()
  expect(manifest.name).toBe('nano-inbox')
  expect(manifest.components.map((c: { tag: string }) => c.tag)).toEqual(['inbox-folders'])
  expect(manifest.components[0].ops.map((o: { name: string }) => o.name)).toEqual(['folders', 'current', 'selected', 'select', 'setFolders'])
  const html = await Bun.file(join(dist, 'index.html')).text()
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)![1]!).imports as Record<string, string>
  expect(Object.keys(map).sort()).toEqual([...SHARED_IMPORTS].sort())
  expect(html).not.toContain('%IMPORTMAP%')
  expect(html).not.toContain('%THEMES%')
  expect(html).toContain('<inbox-folders')
}, 30000)
