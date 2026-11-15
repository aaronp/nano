/**
 * The host's build, into public/: main.js; the shared libraries in shared/ (one copy, named in index.html's import map);
 * bundle/nano-ui.js (packages/ui, itself shared); and the slice example in examples/slice/. Every output imports
 * @pritzlaff/nano, @pritzlaff/nano-ui, lit and typebox through the import map, so a module loaded later shares them.
 */
import { copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..'), pub = join(root, 'public'), repo = join(root, '../..')
for (const d of ['shared', 'bundle', 'examples', 'chunks', 'sandbox']) rmSync(join(pub, d), { recursive: true, force: true })
const external = ['@pritzlaff/nano', '@pritzlaff/nano-ui', 'lit', 'lit/*', 'typebox', 'typebox/*']

async function build(entrypoints: string[], outdir: string, opts: { splitting?: boolean; external?: string[]; entry?: string } = {}) {
  const r = await Bun.build({ entrypoints, outdir, format: 'esm', external: opts.external ?? external, splitting: opts.splitting,
    naming: { entry: opts.entry ?? '[name].[ext]', chunk: 'chunks/[name]-[hash].[ext]' } })
  if (!r.success) { for (const l of r.logs) console.error(l); process.exit(1) }
}

await build([join(root, 'src/main.ts')], pub)
await build(['nano', 'lit', 'lit-ref', 'lit-style-map', 'typebox', 'typebox-value'].map(f => join(root, `src/shared/${f}.ts`)),
  join(pub, 'shared'), { splitting: true, external: [] })
await build([join(repo, 'packages/ui/src/index.ts')], join(pub, 'bundle'), { entry: 'nano-ui.[ext]' })
await build([join(repo, 'examples/slice/shout.ts')], join(pub, 'examples/slice'))
copyFileSync(join(repo, 'examples/slice/nano.json'), join(pub, 'examples/slice/nano.json'))
