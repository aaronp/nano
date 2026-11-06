/**
 * Build a workspace package into its dist/, ready to publish from there (`cd dist && npm publish`):
 *   - one ESM file per `exports` entry, with dependencies and peers left as imports (the shared-peers form);
 *   - .d.ts files;
 *   - dist/package.json: exports pointing at the built files, `workspace:*` turned into real version ranges.
 * With --bundle, also dist/bundle/: every entry with everything inlined (self-contained, for loading by URL).
 *
 * Usage: bun scripts/build-package.ts <package-dir> [--bundle]
 */
import { readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const dir = resolve(process.argv[2] ?? '.')
const dist = join(dir, 'dist')
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const pkg = read(join(dir, 'package.json'))
const entries = Object.entries(pkg.exports as Record<string, string>)
const src = (p: string) => join(dir, p)
const out = (p: string) => p.replace(/^\.\/src\//, './').replace(/\.ts$/, '')

rmSync(dist, { recursive: true, force: true })
const external = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })
const lib = await Bun.build({ entrypoints: entries.map(([, p]) => src(p)), outdir: dist, root: join(dir, 'src'), target: 'browser', format: 'esm', external })
if (!lib.success) throw new AggregateError(lib.logs, 'build failed')
if (process.argv.includes('--bundle')) {
  const b = await Bun.build({ entrypoints: entries.map(([, p]) => src(p)), outdir: join(dist, 'bundle'), root: join(dir, 'src'), target: 'browser', format: 'esm', splitting: true, minify: true })
  if (!b.success) throw new AggregateError(b.logs, 'bundle failed')
}

// Declarations, via a throwaway tsconfig extending the repo's.
const tsconfig = join(dist, 'tsconfig.decl.json')
writeFileSync(tsconfig, JSON.stringify({
  extends: join(root, 'tsconfig.json'),
  compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true, outDir: dist, rootDir: join(dir, 'src'), types: [] },
  files: entries.map(([, p]) => src(p)),
}))
const tsc = Bun.spawnSync(['npx', 'tsc', '-p', tsconfig], { cwd: root, stdout: 'inherit', stderr: 'inherit' })
rmSync(tsconfig)
if (tsc.exitCode !== 0) process.exit(tsc.exitCode ?? 1)

// The publishable manifest.
const versions = new Map<string, string>()
for (const d of readdirSync(join(root, 'packages'))) {
  const p = join(root, 'packages', d, 'package.json')
  if (existsSync(p)) { const j = read(p); versions.set(j.name, j.version) }
}
const pin = (deps?: Record<string, string>) => deps && Object.fromEntries(Object.entries(deps).map(([n, v]) =>
  [n, v.startsWith('workspace:') ? `^${versions.get(n) ?? (() => { throw new Error(`no workspace package ${n}`) })()}` : v]))
const { scripts: _s, devDependencies: _d, ...rest } = pkg
writeFileSync(join(dist, 'package.json'), JSON.stringify({
  ...rest,
  exports: Object.fromEntries(entries.map(([k, p]) => [k, { types: `${out(p)}.d.ts`, default: `${out(p)}.js` }])),
  dependencies: pin(pkg.dependencies),
  peerDependencies: pin(pkg.peerDependencies),
}, null, 2) + '\n')
console.log(`built ${pkg.name} → ${dist}`)
