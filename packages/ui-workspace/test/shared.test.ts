// The host's shared libraries: split modules an imported package reaches through the page's import map, one copy each.
import { expect, test } from 'bun:test'
import { $ } from 'bun'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SHARED } from '../src/shared/specifiers.ts'

const root = join(import.meta.dir, '..'), pub = join(root, 'public')

test('the build writes a module per shared specifier, the import map names each, and lit is defined once', async () => {
  await $`bun run build`.cwd(root).quiet()
  const html = await Bun.file(join(pub, 'index.html')).text()
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)![1]!).imports as Record<string, string>
  expect(Object.keys(map).sort()).toEqual(SHARED.map(s => s.specifier).sort())
  for (const { specifier, file } of SHARED) {
    expect(map[specifier]).toBe(`./shared/${file}.js`)
    expect(await Bun.file(join(pub, 'shared', `${file}.js`)).exists()).toBe(true)
  }
  expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf('type="module"'))   // the map comes first
  const versions = await Bun.file(join(pub, 'shared', 'versions.json')).json()
  for (const p of ['@pritzlaff/nano-core', '@pritzlaff/nano-runes', '@pritzlaff/nano-elements', 'lit', 'typebox']) expect(versions[p]).toMatch(/^\d+\.\d+\.\d+/)
  const js = [...readdirSync(pub, { recursive: true })].map(String).filter(f => f.endsWith('.js'))
  const defining = []
  for (const f of js) if ((await Bun.file(join(pub, f)).text()).includes('litHtmlVersions')) defining.push(f)   // lit-html records itself in this global, once per copy
  expect(defining.length).toBe(1)
}, 60000)
