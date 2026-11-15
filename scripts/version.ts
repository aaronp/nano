/** Sets one version on the named packages (default: nano and elements, which release together; ui has its own line):
 * `bun scripts/version.ts 0.5.0 [nano elements ui]`. Sibling dependencies stay
 * `workspace:*` here; the build fills in this version. Then commit, tag `v<nano-core version>` and push the tag to publish. */
import { join } from 'node:path'
import { PUBLISHED } from './build-packages-list'

const version = process.argv[2] ?? ''
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`usage: bun scripts/version.ts <x.y.z>, got "${version}"`)
for (const dir of process.argv.length > 3 ? process.argv.slice(3) : ['nano', 'elements']) {
  if (!PUBLISHED.includes(dir)) throw new Error(`not a published package: ${dir}`)
  const file = join(import.meta.dir, '..', 'packages', dir, 'package.json')
  const text = await Bun.file(file).text()
  await Bun.write(file, text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`))
  console.log(`${dir} → ${version}`)
}
