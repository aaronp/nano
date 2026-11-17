/**
 * Builds dist/<name>/ for each example: `bun scripts/build.ts`.
 * - <key>.js: each module's entry, with the nano packages, lit and typebox left as bare imports for the host's import map;
 * - nano.json: the example's own, its `modules` rewritten to name those files (./<key>.js).
 */
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** example name -> (module key -> entry file, relative to examples/). */
export const EXAMPLES: Record<string, Record<string, string>> = {
  todo: { 'example.kv': 'kv/memory.ts', 'example.todo': 'todo/todo/kv.ts' },
  chat: { 'example.kv': 'kv/memory.ts', 'example.messaging': 'chat/messaging/kv.ts', 'example.chat': 'chat/room/messaging.ts' },
}

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
  const source = await Bun.file(join(root, name, 'nano.json')).json()
  writeFileSync(join(outdir, 'nano.json'), JSON.stringify({ ...source, modules }, null, 2) + '\n')
}
console.log(`built dist/ (${Object.keys(EXAMPLES).join(', ')})`)
