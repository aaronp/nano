/**
 * The host's build, into public/: main.js; the shared libraries in shared/ (one copy, named in index.html's import map);
 * bundle/nano-ui.js (packages/ui, itself shared); and the slice example in examples/slice/. Every output imports
 * @pritzlaff/nano, @pritzlaff/nano-ui, lit and typebox through the import map, so a module loaded later shares them.
 * With --watch, it builds again on every source change.
 */
import { copyFileSync, rmSync, watch } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..'), pub = join(root, 'public'), repo = join(root, '../..'), watching = process.argv.includes('--watch')
const external = ['@pritzlaff/nano', '@pritzlaff/nano-ui', 'lit', 'lit/*', 'typebox', 'typebox/*']

async function build(entrypoints: string[], outdir: string, opts: { splitting?: boolean; external?: string[]; entry?: string } = {}) {
  const r = await Bun.build({ entrypoints, outdir, format: 'esm', external: opts.external ?? external, splitting: opts.splitting,
    naming: { entry: opts.entry ?? '[name].[ext]', chunk: 'chunks/[name]-[hash].[ext]' } })
  if (!r.success) { for (const l of r.logs) console.error(l); if (!watching) process.exit(1) }
}

async function all() {
  for (const d of ['shared', 'bundle', 'examples', 'chunks', 'sandbox']) rmSync(join(pub, d), { recursive: true, force: true })
  await build([join(root, 'src/main.ts')], pub)
  await build(['nano', 'lit', 'lit-ref', 'lit-style-map', 'typebox', 'typebox-value'].map(f => join(root, `src/shared/${f}.ts`)),
    join(pub, 'shared'), { splitting: true, external: [] })
  await build([join(repo, 'packages/ui/src/index.ts')], join(pub, 'bundle'), { entry: 'nano-ui.[ext]' })
  await build([join(repo, 'examples/slice/shout.ts')], join(pub, 'examples/slice'))
  copyFileSync(join(repo, 'examples/slice/nano.json'), join(pub, 'examples/slice/nano.json'))
}

await all()
if (watching) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const again = () => { clearTimeout(timer); timer = setTimeout(() => void all().catch(e => console.error(e)), 100) }
  for (const d of ['packages/ui-workspace/src', 'packages/ui/src', 'packages/nano/src', 'packages/elements/src', 'examples/slice'])
    watch(join(repo, d), { recursive: true }, again)
}
