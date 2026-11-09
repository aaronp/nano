// The build: a module that leaves the shared packages to the host, its manifest, and the preview page.
import { expect, test } from 'bun:test'
import { $ } from 'bun'
import { join } from 'node:path'

const dist = join(import.meta.dir, '..', 'dist')

test('the build writes the module, manifest and preview; the module carries no copy of the shared packages', async () => {
  await $`bun scripts/build.ts`.cwd(join(import.meta.dir, '..')).quiet()
  const js = await Bun.file(join(dist, 'index.js')).text()
  for (const p of ['@pritzlaff/nano-runes', '@pritzlaff/nano-elements', 'lit', 'typebox']) expect(js).toMatch(new RegExp(`from"${p}"`))
  expect(js).not.toContain('ReactiveElement')   // lit's base class
  expect(js).not.toContain('TypeBox')           // typebox's own code
  const manifest = await Bun.file(join(dist, 'manifest.json')).json()
  expect(manifest.components.map((c: { tag: string }) => c.tag)).toEqual(['nano-timer'])
  const html = await Bun.file(join(dist, 'index.html')).text()
  expect(html).toContain('"@pritzlaff/nano-core": "https://esm.sh/*@pritzlaff/nano-core@^0.1.0"')
  expect(html).toContain('"typebox/": "https://esm.sh/typebox@^1.4.0/"')
  expect(html).not.toContain('%IMPORTMAP%')
}, 30000)
