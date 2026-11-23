/**
 * Installs the built packages the way a stranger would, and uses them: `bun scripts/smoke-packages.ts`
 * (after build-packages). Packs each dist into a tarball, installs them with typebox and lit from npm into a
 * scratch folder, type-checks a consumer of nano-core, nano-elements and nano-ui under both `bundler` and `nodenext` resolution, and runs it in Node.
 */
import { $ } from 'bun'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APPS, PUBLISHED } from './build-packages-list'

const root = join(import.meta.dir, '..'), at = mkdtempSync(join(tmpdir(), 'nano-smoke-'))
const deps: Record<string, string> = { typebox: '^1.4.0', lit: '^3.0.0' }
for (const dir of PUBLISHED) {
  const dist = join(root, 'packages', dir, 'dist')
  const { name } = await Bun.file(join(dist, 'package.json')).json()
  const file = (await $`npm pack ${dist} --pack-destination ${at} --silent`.cwd(at).text()).trim()
  deps[name] = `file:./${file}`
}
// the apps: packed (not installed), with the CLI and the app in the tarball and no docs/
for (const dir of APPS) {
  const dist = join(root, 'packages', dir, 'dist')
  const files = JSON.parse(await $`npm pack ${dist} --dry-run --json`.cwd(at).text())[0].files.map((f: { path: string }) => f.path)
  for (const need of ['bin/nano-app.ts', 'app/index.html']) if (!files.includes(need)) throw new Error(`${dir} package lacks ${need}`)
  if (files.some((f: string) => f.startsWith('app/docs/'))) throw new Error(`${dir} package ships app/docs/`)
}
await Bun.write(join(at, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: 'module', dependencies: deps }))
await $`npm install --no-audit --no-fund --silent`.cwd(at)

// a stranger's app: the slice example (nano.json over nano.ui plus a provider of its own), assembled, swapped and run headlessly
const nanoJson = await Bun.file(join(root, 'examples/slice/nano.json')).text()
await Bun.write(join(at, 'consumer.ts'), `
import { Application, AppDeployment, Registry, Implementation, Pod, provide, Provider, success } from '@pritzlaff/nano-core'
import uiProvider, { MapIface } from '@pritzlaff/nano-ui'
import '@pritzlaff/nano-elements'

const shout = Implementation.define('smoke/shout', { provides: [MapIface], make: () => [provide(MapIface, { map: async (x: unknown) => success(\`\${x}!\`) })] })
const mine = Provider.define('smoke', [shout])
const must = <T>(r: { ok: true; value: T } | { ok: false; fail: { reason: string } }): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

const registry = Registry.create()
must(registry.add(uiProvider)); must(registry.add(mine))
const deployment: AppDeployment = ${nanoJson}
const app = must(await Application.create(must(AppDeployment.assemble(deployment, registry)), {}))
must(await app.apply({ ...deployment, pods: { ...deployment.pods, up: Pod.lazy(mine.implementations.get('smoke/shout')!) } }))
await app.call('main', 'in').submit('hi')
await new Promise(r => setTimeout(r, 100))
const out = await app.call('main', 'out').entries(null)
if (!out.ok || (out.value as string[]).join() !== 'hi!') throw new Error('expected hi!, got ' + JSON.stringify(out))
console.log('smoke: logged', out.value)
`)
const tsc = join(root, 'node_modules/.bin/tsc')
const common = ['--noEmit', '--strict', '--skipLibCheck', 'false', '--target', 'ESNext', '--lib', 'ESNext,DOM', '--types', '', 'consumer.ts']
await $`${tsc} --module ESNext --moduleResolution bundler ${common}`.cwd(at)
await $`${tsc} --module NodeNext --moduleResolution NodeNext ${common}`.cwd(at)
await $`${tsc} --module NodeNext --moduleResolution NodeNext --target ESNext --lib ESNext,DOM --types '' --skipLibCheck --outDir out consumer.ts`.cwd(at)
await $`node out/consumer.js`.cwd(at)
console.log(`smoke passed in ${at}`)
