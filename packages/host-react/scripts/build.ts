/**
 * Builds the React host into the workspace's public/react/ (served at /react/): main.js (React, the host core and the Outline bundled
 * in; nano-core, nano-ui, nano-elements, lit and typebox left to the page's import map, the workspace's shared copies)
 * and index.html.
 */
import { copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..'), out = join(root, '../ui-workspace/public/react')
rmSync(out, { recursive: true, force: true })
const r = await Bun.build({
  entrypoints: [join(root, 'src/main.tsx')], outdir: out, format: 'esm', target: 'browser', minify: true,
  external: ['@pritzlaff/nano-core', '@pritzlaff/nano-elements', '@pritzlaff/nano-ui', 'lit', 'lit/*', 'typebox', 'typebox/*'],
  define: { 'process.env.NODE_ENV': '"production"' },
})
if (!r.success) { for (const l of r.logs) console.error(l); process.exit(1) }
copyFileSync(join(root, 'index.html'), join(out, 'index.html'))
