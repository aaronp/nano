/**
 * Builds dist/: `bun scripts/build.ts`.
 * - index.js: the provider module, with the nano packages, lit and typebox left as bare imports for the host's import map;
 * - nano.json: copied as it is (its `modules` name ./index.js).
 */
import { copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..'), dist = join(root, 'dist')
rmSync(dist, { recursive: true, force: true })
const built = await Bun.build({
  entrypoints: [join(root, 'src/index.ts')], outdir: dist, format: 'esm', target: 'browser', minify: true, sourcemap: 'linked',
  external: ['@pritzlaff/nano-core', '@pritzlaff/nano-elements', '@pritzlaff/nano-ui', 'lit', 'lit/*', 'typebox', 'typebox/*'],
})
if (!built.success) throw new AggregateError(built.logs, 'build failed')
copyFileSync(join(root, 'nano.json'), join(dist, 'nano.json'))
console.log('built dist/ (index.js, nano.json)')
