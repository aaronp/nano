/**
 * Before a build: clears the split output (public/chunks, public/shared; their names change with their contents) and
 * writes public/shared/versions.json, the versions of the shared libraries the host provides, for import checks.
 */
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
for (const d of ['chunks', 'shared']) rmSync(join(root, 'public', d), { recursive: true, force: true })
for (const f of readdirSync(join(root, 'public'))) if (/^main-.+\.js(\.map)?$/.test(f)) rmSync(join(root, 'public', f))   // chunks from before chunks/
const version = async (p: string) => (await Bun.file(join(root, 'node_modules', p, 'package.json')).json()).version as string
const names = ['@pritzlaff/nano-core', '@pritzlaff/nano-runes', '@pritzlaff/nano-elements', 'lit', 'typebox']
await Bun.write(join(root, 'public/shared/versions.json'), JSON.stringify(Object.fromEntries(await Promise.all(names.map(async n => [n, await version(n)]))), null, 2) + '\n')
