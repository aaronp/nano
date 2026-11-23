/**
 * Builds dist/: `bun scripts/build.ts`.
 * - index.js: the provider module, with the nano packages, lit and typebox left as bare imports for the host's import map;
 * - nano.json: copied, its `modules` naming ./index.js; with PUBLIC_URL set (`https://owner.github.io/repo/`, where dist/
 *   is served), `${PUBLIC_URL}index.js`, so a downloaded nano.json loads from anywhere.
 * index.js ends `export const built = { '@pritzlaff/nano-core': '<version>' }`: the installed nano-core it was built with.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..'), dist = join(root, 'dist'), PUBLIC_URL = process.env.PUBLIC_URL
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'))
const { version } = read('node_modules/@pritzlaff/nano-core/package.json')
rmSync(dist, { recursive: true, force: true })
const built = await Bun.build({
  entrypoints: [join(root, 'src/index.ts')], outdir: dist, format: 'esm', target: 'browser', minify: true, sourcemap: 'linked',
  footer: `export const built = ${JSON.stringify({ '@pritzlaff/nano-core': version })}`,
  external: ['@pritzlaff/nano-core', '@pritzlaff/nano-elements', '@pritzlaff/nano-ui', 'lit', 'lit/*', 'typebox', 'typebox/*'],
})
if (!built.success) throw new AggregateError(built.logs, 'build failed')
const doc = read('nano.json')   // a bare deployment, or a saved host document whose modules are under `app`
if (PUBLIC_URL) for (const modules of [doc.modules, doc.app?.modules]) for (const k in modules) modules[k] = new URL(modules[k], PUBLIC_URL).href
writeFileSync(join(dist, 'nano.json'), JSON.stringify(doc, null, 2) + '\n')
console.log('built dist/ (index.js, nano.json)')
