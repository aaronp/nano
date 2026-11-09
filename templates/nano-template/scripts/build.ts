/**
 * Builds dist/: `bun scripts/build.ts`.
 * - index.js: the package's module, with the shared packages left as bare imports for the host to provide;
 * - manifest.json: what a host reads first (see src/manifest.ts);
 * - index.html: a preview page, with an import map to the shared packages on esm.sh.
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { catalog } from '../src'
import { manifestOf, SHARED, SHARED_IMPORTS } from '../src/manifest'

const root = join(import.meta.dir, '..'), dist = join(root, 'dist')
const pkg = await Bun.file(join(root, 'package.json')).json()
rmSync(dist, { recursive: true, force: true })

const built = await Bun.build({
  entrypoints: [join(root, 'src/index.ts')], outdir: dist, format: 'esm', target: 'browser', minify: true, sourcemap: 'linked',
  external: SHARED_IMPORTS,
})
if (!built.success) throw new AggregateError(built.logs, 'build failed')

await Bun.write(join(dist, 'manifest.json'), JSON.stringify(manifestOf(catalog, pkg), null, 2) + '\n')

// the nano packages keep their own imports bare (esm.sh's `*`), so core, lit and typebox load once, through the map
const pkgOf = (spec: string) => SHARED.find(p => spec === p || spec.startsWith(p + '/'))!
const at = (spec: string) => { const p = pkgOf(spec); return `https://esm.sh/${p.startsWith('@pritzlaff/') ? '*' : ''}${p}@${pkg.dependencies[p]}${spec.slice(p.length)}` }
const imports = Object.fromEntries(SHARED_IMPORTS.map(s => [s, at(s)]))
const page = await Bun.file(join(root, 'preview/index.html')).text()
await Bun.write(join(dist, 'index.html'), page.replace('%IMPORTMAP%', JSON.stringify({ imports }, null, 2)))
console.log(`built ${pkg.name}@${pkg.version} → dist/ (index.js, manifest.json, index.html)`)
