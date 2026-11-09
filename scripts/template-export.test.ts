// The template export, dry-run against a scratch bare repository (nothing is pushed).
import { expect, test } from 'bun:test'
import { $ } from 'bun'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dir, '..'), script = join(import.meta.dir, 'template-export.sh')

test('the first export into an empty repository makes main, with the committed template only', async () => {
  const bare = mkdtempSync(join(tmpdir(), 'tpl-bare-')), stray = join(root, 'templates/nano-template/stray-uncommitted.txt')
  await $`git init --quiet --bare ${bare}`
  writeFileSync(stray, 'not committed')
  try {
    const r = await $`DRY_RUN=1 ${script} ${bare}`.nothrow().quiet()
    const out = r.stdout.toString() + r.stderr.toString()
    expect(r.exitCode, out).toBe(0)
    expect(out).toContain('would push: Export from aaronp/nano@')
    expect(out).toContain('package.json')
    expect(out).toContain('.github/workflows/ci.yml')
    expect(out).not.toContain('stray-uncommitted.txt')
    expect(out).not.toContain('node_modules')
  } finally { rmSync(stray, { force: true }) }
}, 30000)
