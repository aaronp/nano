/** Sets one version on every published package: `bun scripts/version.ts 0.2.0`. Sibling dependencies stay
 * `workspace:*` here; the build fills in this version. Then commit, tag `v0.2.0` and push the tag to publish. */
import { join } from 'node:path'
import { PUBLISHED } from './build-packages-list'

const version = process.argv[2] ?? ''
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`usage: bun scripts/version.ts <x.y.z>, got "${version}"`)
for (const dir of PUBLISHED) {
  const file = join(import.meta.dir, '..', 'packages', dir, 'package.json')
  const text = await Bun.file(file).text()
  await Bun.write(file, text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`))
  console.log(`${dir} → ${version}`)
}
