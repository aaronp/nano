/**
 * The host's build, into public/ (after prebuild.ts): main.js (CSS imported as text: the dock's golden-layout styles); sandbox/boot.js (a sandboxed pod's frame); the shared libraries in shared/ (one copy, named in index.html's import map);
 * bundle/nano-ui.js (packages/ui, itself shared); the slice example in examples/slice/, and the template in examples/template/ (index.js, nano.json). Every output imports
 * @pritzlaff/nano-core, nano-elements, nano-ui, lit and typebox through the import map, so a module loaded later shares them.
 * With --watch, it builds again on every source change.
 */
import { copyFileSync, rmSync, watch } from 'node:fs'
import { join } from 'node:path'
import { SHARED } from '../src/shared/specifiers.ts'

const root = join(import.meta.dir, '..'), pub = join(root, 'public'), repo = join(root, '../..'), watching = process.argv.includes('--watch')
const external = ['@pritzlaff/nano-core', '@pritzlaff/nano-elements', '@pritzlaff/nano-ui', 'lit', 'lit/*', 'typebox', 'typebox/*']

async function build(entrypoints: string[], outdir: string, opts: { splitting?: boolean; external?: string[]; entry?: string } = {}) {
  const r = await Bun.build({ entrypoints, outdir, format: 'esm', external: opts.external ?? external, splitting: opts.splitting, loader: { '.css': 'text' },
    naming: { entry: opts.entry ?? '[name].[ext]', chunk: 'chunks/[name]-[hash].[ext]' } })
  if (!r.success) { for (const l of r.logs) console.error(l); if (!watching) process.exit(1) }
}

async function all() {
  for (const d of ['bundle', 'examples', 'sandbox']) rmSync(join(pub, d), { recursive: true, force: true })   // shared/ and chunks/: prebuild.ts
  await build([join(root, 'src/main.ts')], pub)
  await build([join(root, 'src/sandbox/boot.ts')], join(pub, 'sandbox'))   // the frame's entry; its import map is the host's
  await build(SHARED.map(s => join(root, `src/shared/${s.file}.ts`)), join(pub, 'shared'), { splitting: true, external: [] })
  await build([join(repo, 'packages/ui/src/index.ts')], join(pub, 'bundle'), { entry: 'nano-ui.[ext]' })
  await build([join(repo, 'examples/slice/shout.ts')], join(pub, 'examples/slice'))
  copyFileSync(join(repo, 'examples/slice/nano.json'), join(pub, 'examples/slice/nano.json'))
  await build([join(repo, 'templates/nano-template/src/index.ts')], join(pub, 'examples/template'))
  copyFileSync(join(repo, 'templates/nano-template/nano.json'), join(pub, 'examples/template/nano.json'))
}

await all()
if (watching) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const again = () => { clearTimeout(timer); timer = setTimeout(() => void all().catch(e => console.error(e)), 100) }
  for (const d of ['packages/ui-workspace/src', 'packages/ui/src', 'packages/nano/src', 'packages/elements/src', 'examples/slice', 'templates/nano-template/src'])
    watch(join(repo, d), { recursive: true }, again)
}
