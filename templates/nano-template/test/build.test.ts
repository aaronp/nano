// The build: a module that leaves the shared packages to the host, and the nano.json beside it.
import { expect, test } from 'bun:test'
import { $ } from 'bun'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')

test('dist/index.js leaves the shared packages bare; dist/nano.json names ./index.js', async () => {
  await $`bun scripts/build.ts`.cwd(root).quiet()
  const js = await Bun.file(join(root, 'dist/index.js')).text()
  for (const p of ['@pritzlaff/nano-core', '@pritzlaff/nano-elements', 'lit', 'typebox']) expect(js).toMatch(new RegExp(`from"${p}"`))
  expect(js).not.toContain('ReactiveElement')   // lit's base class
  expect((await Bun.file(join(root, 'dist/nano.json')).json()).modules).toEqual({ 'acme.template': './index.js' })
}, 30000)

test('with PUBLIC_URL, dist/nano.json names the module by its URL under it; the bundle is stamped', async () => {
  await $`bun scripts/build.ts`.cwd(root).env({ ...process.env, PUBLIC_URL: 'https://owner.github.io/repo/' }).quiet()
  expect((await Bun.file(join(root, 'dist/nano.json')).json()).modules).toEqual({ 'acme.template': 'https://owner.github.io/repo/index.js' })
  const { version } = await Bun.file(join(root, 'node_modules/@pritzlaff/nano-core/package.json')).json()
  expect(await Bun.file(join(root, 'dist/index.js')).text()).toContain(`export const built = {"@pritzlaff/nano-core":"${version}"}`)
  await $`bun scripts/build.ts`.cwd(root).quiet()   // back to relative
}, 30000)
