// The build: a module that leaves the shared packages to the host, and the nano.json beside it.
import { expect, test } from 'bun:test'
import { $ } from 'bun'
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

test('with PUBLIC_URL, a saved host document has its app.modules rewritten; the rest is copied', async () => {
  // a temp copy of the template: the real nano.json and dist/ are never touched
  const tmp = mkdtempSync(join(tmpdir(), 'nano-template-build-'))
  try {
    for (const f of ['scripts', 'src']) cpSync(join(root, f), join(tmp, f), { recursive: true })
    for (const f of ['package.json', 'tsconfig.json']) cpSync(join(root, f), join(tmp, f))
    symlinkSync(join(root, 'node_modules'), join(tmp, 'node_modules'))
    const host = { app: { ...(await Bun.file(join(root, 'nano.json')).json()), modules: { 'acme.template': './index.js' } }, outline: { title: 'x' }, host: { name: 'y' } }
    await Bun.write(join(tmp, 'nano.json'), JSON.stringify(host))
    await $`bun scripts/build.ts`.cwd(tmp).env({ ...process.env, PUBLIC_URL: 'https://owner.github.io/repo/' }).quiet()
    const out = await Bun.file(join(tmp, 'dist/nano.json')).json()
    expect(out.app.modules).toEqual({ 'acme.template': 'https://owner.github.io/repo/index.js' })
    expect(out.outline).toEqual(host.outline)
    expect(out.host).toEqual(host.host)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}, 30000)
