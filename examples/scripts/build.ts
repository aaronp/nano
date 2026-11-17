/**
 * Builds dist/<name>/ for each example: `bun scripts/build.ts`.
 * - <key>.js: each module's entry, with the nano packages, lit and typebox left as bare imports for the host's import map;
 * - nano.json: the example's own, its `modules` rewritten to name those files (./<key>.js);
 * - a module several examples share (`example.kv`) is built once, to dist/kv/, and named there (../kv/<key>.js), so
 *   one host can import those examples side by side: one provider, one URL.
 * - every bundle ends `export const built = { '@pritzlaff/nano-core': '<version>' }`, the nano-core it was built with.
 * With PUBLIC_URL set (`https://owner.github.io/repo/`), `modules` are absolute: `${PUBLIC_URL}examples/<name>/<key>.js`
 * (the shared kv `${PUBLIC_URL}examples/kv/example.kv.js`), where ui-workspace's build puts them in public/; a downloaded
 * nano.json then loads from anywhere. `bun scripts/build.ts <outdir>` builds elsewhere than dist/.
 */
import { rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { version } from '../../packages/nano/package.json'

/** example name -> (module key -> entry file, relative to examples/); `kv` is the shared folder, no example. */
export const EXAMPLES: Record<string, Record<string, string>> = {
  kv: { 'example.kv': 'kv/memory.ts' },
  todo: { 'example.todo': 'todo/index.ts' },
  chat: { 'example.messaging': 'chat/messaging/kv.ts', 'example.chat': 'chat/index.ts' },
  auth: { 'example.auth': 'auth/index.ts' },
}
const SHARED: Record<string, string> = { 'example.kv': '../kv/example.kv.js' }

const root = join(import.meta.dir, '..'), dist = process.argv[2] ? resolve(process.argv[2]) : join(root, 'dist'), PUBLIC_URL = process.env.PUBLIC_URL
const footer = `export const built = ${JSON.stringify({ '@pritzlaff/nano-core': version })}`
rmSync(dist, { recursive: true, force: true })
for (const [name, entries] of Object.entries(EXAMPLES)) {
  const outdir = join(dist, name), modules: Record<string, string> = {}
  for (const [key, entry] of Object.entries(entries)) {
    const built = await Bun.build({
      entrypoints: [join(root, entry)], outdir, format: 'esm', target: 'browser', minify: true, naming: `${key}.js`, footer,
      external: ['@pritzlaff/nano-core', '@pritzlaff/nano-elements', '@pritzlaff/nano-ui', 'lit', 'lit/*', 'typebox', 'typebox/*'],
    })
    if (!built.success) throw new AggregateError(built.logs, `build failed: ${name}/${key}`)
    modules[key] = `./${key}.js`
  }
  if (name === 'kv') continue
  const source = await Bun.file(join(root, name, 'nano.json')).json()
  for (const key of Object.keys(source.modules ?? {})) modules[key] ??= SHARED[key] ?? (() => { throw new Error(`${name}/nano.json: no build for module ${key}`) })()
  if (PUBLIC_URL) for (const k in modules) modules[k] = new URL(modules[k]!, new URL(`examples/${name}/`, PUBLIC_URL)).href
  writeFileSync(join(outdir, 'nano.json'), JSON.stringify({ ...source, modules }, null, 2) + '\n')
}
console.log(`built dist/ (${Object.keys(EXAMPLES).join(', ')})`)
