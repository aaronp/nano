/**
 * Builds dist/<name>/ for each example: `bun scripts/build.ts`.
 * - <key>.js: each module's entry, with the nano packages, lit and typebox left as bare imports for the host's import map;
 * - nano.json: the example's own, its `modules` rewritten to name those files (./<key>.js);
 * - a module several examples share (`example.kv`) is built once, to dist/kv/, and named there (../kv/<key>.js), so
 *   one host can import those examples side by side: one provider, one URL.
 */
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** example name -> (module key -> entry file, relative to examples/); `kv` is the shared folder, no example. */
export const EXAMPLES: Record<string, Record<string, string>> = {
  kv: { 'example.kv': 'kv/memory.ts' },
  todo: { 'example.todo': 'todo/index.ts' },
  chat: { 'example.messaging': 'chat/messaging/kv.ts', 'example.chat': 'chat/index.ts' },
  auth: { 'example.auth': 'auth/index.ts' },
}
const SHARED: Record<string, string> = { 'example.kv': '../kv/example.kv.js' }

const root = join(import.meta.dir, '..'), dist = join(root, 'dist')
rmSync(dist, { recursive: true, force: true })
for (const [name, entries] of Object.entries(EXAMPLES)) {
  const outdir = join(dist, name), modules: Record<string, string> = {}
  for (const [key, entry] of Object.entries(entries)) {
    const built = await Bun.build({
      entrypoints: [join(root, entry)], outdir, format: 'esm', target: 'browser', minify: true, naming: `${key}.js`,
      external: ['@pritzlaff/nano-core', '@pritzlaff/nano-elements', '@pritzlaff/nano-ui', 'lit', 'lit/*', 'typebox', 'typebox/*'],
    })
    if (!built.success) throw new AggregateError(built.logs, `build failed: ${name}/${key}`)
    modules[key] = `./${key}.js`
  }
  if (name === 'kv') continue
  const source = await Bun.file(join(root, name, 'nano.json')).json()
  for (const key of Object.keys(source.modules ?? {})) modules[key] ??= SHARED[key]!
  writeFileSync(join(outdir, 'nano.json'), JSON.stringify({ ...source, modules }, null, 2) + '\n')
}
console.log(`built dist/ (${Object.keys(EXAMPLES).join(', ')})`)
