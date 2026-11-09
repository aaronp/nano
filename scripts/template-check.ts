/**
 * Checks the template against the libraries in this commit, not the published ones: `bun scripts/template-check.ts`.
 * Builds the packages, copies the template to a scratch folder, installs it with the packed packages in place of
 * the npm versions, and runs its tests and build. The template's own folder and lockfile are left untouched.
 */
import { $ } from 'bun'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PUBLISHED } from './build-packages-list'

const root = join(import.meta.dir, '..'), template = join(root, 'templates/nano-template')
await $`bun ${join(import.meta.dir, 'build-packages.ts')}`.quiet()

const at = mkdtempSync(join(tmpdir(), 'nano-template-check-'))
cpSync(template, at, { recursive: true, filter: src => !/[/\\](node_modules|dist)([/\\]|$)/.test(src.slice(template.length)) })
const original = await Bun.file(join(at, 'package.json')).text(), pkg = JSON.parse(original)
for (const dir of PUBLISHED) {
  const dist = join(root, 'packages', dir, 'dist')
  const { name } = await Bun.file(join(dist, 'package.json')).json()
  const file = (await $`npm pack ${dist} --pack-destination ${at} --silent`.cwd(at).text()).trim()
  pkg.dependencies[name] = `file:./${file}`
}
await Bun.write(join(at, 'package.json'), JSON.stringify(pkg, null, 2))
await $`rm -f bun.lock`.cwd(at)
await $`bun install`.cwd(at).quiet()
await Bun.write(join(at, 'package.json'), original)   // the template's own ranges again, for its manifest and preview
await $`bun test`.cwd(at)
await $`bun run build`.cwd(at)
console.log(`the template passes against this commit's libraries (${at})`)
