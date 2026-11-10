/**
 * Builds the published packages into publishable folders: `bun scripts/build-packages.ts`.
 * Each `packages/<dir>/dist/` gets the bundled ES module, `.d.ts` types, the README and LICENSE, and a package.json
 * made from the source one: exports point at the build, the version is filled in for sibling packages, and
 * typebox, lit and sibling packages become peer dependencies so a host and what it imports share one copy.
 * CI publishes each `dist/` folder (`npm publish packages/<dir>/dist`).
 */
import { $ } from 'bun'
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PUBLISHED } from './build-packages-list'

const root = join(import.meta.dir, '..')
const REPO = { type: 'git', url: 'git+https://github.com/aaronp/nano.git' }
const PEERS = ['typebox', 'lit']

type Pkg = { name: string; version: string; description?: string; dependencies?: Record<string, string> }

for (const dir of PUBLISHED) {
  const at = join(root, 'packages', dir), out = join(at, 'dist')
  const src: Pkg = await Bun.file(join(at, 'package.json')).json()
  rmSync(out, { recursive: true, force: true })

  // the code: one ES module; dependencies stay imports
  const built = await Bun.build({ entrypoints: [join(at, 'src/index.ts')], outdir: out, format: 'esm', target: 'browser', packages: 'external', sourcemap: 'linked' })
  if (!built.success) throw new AggregateError(built.logs, `building ${src.name} failed`)

  // the types: one .d.ts per source file, with relative imports given .js so every module resolution finds them
  // (sibling packages resolve to their built types, so only this package's sources are emitted)
  const paths = Object.fromEntries(PUBLISHED.filter(d => d !== dir).map(d => [`@pritzlaff/nano-${d}`, [`../${d}/dist/index.d.ts`]]))
  const config = join(at, 'tsconfig.build.json')
  await Bun.write(config, JSON.stringify({
    compilerOptions: { strict: true, module: 'ESNext', moduleResolution: 'bundler', target: 'ESNext', lib: ['ESNext', 'DOM'], skipLibCheck: true, types: [],
      declaration: true, emitDeclarationOnly: true, rootDir: 'src', outDir: 'dist', paths },
    files: ['src/index.ts'],
  }))
  try { await $`${join(root, 'node_modules/.bin/tsc')} -p ${config}` } finally { rmSync(config) }
  // (in subfolders too; `from '…'`, `import('…')` and side-effect `import '…'`)
  for (const f of readdirSync(out, { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.d.ts'))) {
    const text = await Bun.file(join(out, f)).text()
    await Bun.write(join(out, f), text.replace(/(from\s+|import\s*\(|import\s+)(['"])(\.\.?\/[^'"]+?)(?<!\.js)\2/g, '$1$2$3.js$2'))
  }

  const deps = src.dependencies ?? {}
  const peerDependencies = Object.fromEntries(Object.entries(deps).map(([k, v]) => [k, v === 'workspace:*' ? `^${src.version}` : v]))
  const pkg = {
    name: src.name, version: src.version, description: src.description, license: 'MIT', type: 'module',
    repository: { ...REPO, directory: `packages/${dir}` },
    exports: { '.': { types: './index.d.ts', import: './index.js' } }, types: './index.d.ts', module: './index.js',
    sideEffects: false, peerDependencies, publishConfig: { access: 'public' },
  }
  if (Object.keys(deps).some(d => !PEERS.includes(d) && deps[d] !== 'workspace:*')) throw new Error(`${src.name} has a dependency that is neither shared nor a sibling`)
  await Bun.write(join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  await Bun.write(join(out, 'README.md'), Bun.file(join(at, 'README.md')))
  await Bun.write(join(out, 'LICENSE'), Bun.file(join(root, 'LICENSE')))
  console.log(`built ${src.name}@${src.version} → packages/${dir}/dist`)
}
