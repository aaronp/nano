/**
 * A provider's own frame page, for its `home-origin` pods: dist/<name>/frame.html and, beside it, _nano/ holding the
 * frame's runtime (the workspace's sandbox boot, nano-ui and the shared libraries), so the page runs only code from its
 * own origin: a page that frames it chooses nothing that runs there. The workspace opens it as `<iframe src>`.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SHARED } from '../../packages/ui-workspace/src/shared/specifiers.ts'

const ws = join(import.meta.dir, '../../packages/ui-workspace'), repo = join(import.meta.dir, '../..')
const external = ['@pritzlaff/nano-core', '@pritzlaff/nano-elements', '@pritzlaff/nano-ui', 'lit', 'lit/*', 'typebox', 'typebox/*']

async function build(entrypoints: string[], outdir: string, opts: { splitting?: boolean; external?: string[]; entry?: string } = {}) {
  const r = await Bun.build({ entrypoints, outdir, format: 'esm', target: 'browser', minify: true, external: opts.external ?? external, splitting: opts.splitting,
    loader: { '.css': 'text' }, naming: { entry: opts.entry ?? '[name].[ext]', chunk: 'chunks/[name]-[hash].[ext]' } })
  if (!r.success) throw new AggregateError(r.logs, `frame build failed: ${outdir}`)
}

/** Writes frame.html and _nano/ into `outdir`. */
export async function framePage(outdir: string) {
  const nano = join(outdir, '_nano')
  await build([join(ws, 'src/sandbox/boot.ts')], join(nano, 'sandbox'))
  await build(SHARED.map(s => join(ws, `src/shared/${s.file}.ts`)), join(nano, 'shared'), { splitting: true, external: [] })
  await build([join(repo, 'packages/ui/src/index.ts')], join(nano, 'bundle'), { entry: 'nano-ui.[ext]' })
  const imports = { ...Object.fromEntries(SHARED.map(s => [s.specifier, `./_nano/shared/${s.file}.js`])), '@pritzlaff/nano-ui': './_nano/bundle/nano-ui.js' }
  writeFileSync(join(outdir, 'frame.html'), `<!doctype html><html><head><meta charset="utf-8">` +
    `<style>html,body{margin:0}body{background:var(--bg);color:var(--fg);font-family:var(--font)}</style>` +
    `<script type="importmap">${JSON.stringify({ imports })}</script><script type="module" src="./_nano/sandbox/boot.js"></script></head><body></body></html>\n`)
}
