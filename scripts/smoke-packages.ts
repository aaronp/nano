/**
 * Installs the built packages the way a stranger would, and uses them: `bun scripts/smoke-packages.ts`
 * (after build-packages). Packs each dist into a tarball, installs them with typebox and lit from npm into a
 * scratch folder, type-checks a consumer under both `bundler` and `nodenext` resolution, and runs it in Node.
 */
import { $ } from 'bun'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PUBLISHED } from './build-packages-list'

const root = join(import.meta.dir, '..'), at = mkdtempSync(join(tmpdir(), 'nano-smoke-'))
const deps: Record<string, string> = { typebox: '^1.4.0', lit: '^3.0.0' }
for (const dir of PUBLISHED) {
  const dist = join(root, 'packages', dir, 'dist')
  const { name } = await Bun.file(join(dist, 'package.json')).json()
  const file = (await $`npm pack ${dist} --pack-destination ${at} --silent`.cwd(at).text()).trim()
  deps[name] = `file:./${file}`
}
await Bun.write(join(at, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: 'module', dependencies: deps }))
await $`npm install --no-audit --no-fund --silent`.cwd(at)

// a stranger's component: a rune counter in a registry, called through a runtime, and an element class over it
await Bun.write(join(at, 'consumer.ts'), `
import { Ops, Registries, Runtimes, Components } from '@pritzlaff/nano-core'
import { component, state } from '@pritzlaff/nano-runes'
import { PlacedElement } from '@pritzlaff/nano-elements'

export const Counter = component('smoke.test/counter', () => {
  const s = state({ count: 0 })
  return { get count() { return s.count }, increment: () => { s.count += 1 } }
})
export class CounterEl extends PlacedElement { static component = Counter }

const rt = Runtimes.create(Registries.create('smoke'))
rt.registry.add('c', Components.instantiate(Counter))
const me = { registry: 'smoke', instance: 'test' }
await rt.call(me, 'c', Ops.key(Counter.ops.increment), null)
const r = await rt.call(me, 'c', Ops.key(Counter.ops.count), null)
if (!('value' in r) || r.value !== 1) throw new Error('expected count 1, got ' + JSON.stringify(r))
console.log('smoke: count is', r.value, '· element class', typeof CounterEl)
`)
const tsc = join(root, 'node_modules/.bin/tsc')
const common = ['--noEmit', '--strict', '--skipLibCheck', 'false', '--target', 'ESNext', '--lib', 'ESNext,DOM', '--types', '', 'consumer.ts']
await $`${tsc} --module ESNext --moduleResolution bundler ${common}`.cwd(at)
await $`${tsc} --module NodeNext --moduleResolution NodeNext ${common}`.cwd(at)
await $`${tsc} --module NodeNext --moduleResolution NodeNext --target ESNext --lib ESNext,DOM --types '' --skipLibCheck --outDir out consumer.ts`.cwd(at)
await $`node out/consumer.js`.cwd(at)
console.log(`smoke passed in ${at}`)
