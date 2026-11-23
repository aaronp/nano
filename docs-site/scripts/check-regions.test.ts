import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRegions } from './check-regions'

const site = (files: Record<string, string>, pub: Record<string, string> = {}) => {
  const d = mkdtempSync(join(tmpdir(), 'regions-'))
  const write = (base: string, fs: Record<string, string>) => {
    for (const [p, c] of Object.entries(fs)) { mkdirSync(join(base, p, '..'), { recursive: true }); writeFileSync(join(base, p), c) }
  }
  write(join(d, 'root'), files); write(join(d, 'public'), pub)
  return [join(d, 'root'), join(d, 'public')] as const
}
const embed = '<<< @/../a.ts#pod\n'

test('a region present is fine', () => {
  const [root, pub] = site({ 'p.md': embed, '../a.ts': '// #region pod\nx\n// #endregion pod\n' })
  expect(checkRegions(root, pub)).toEqual([])
})
test('a missing region names file and region', () => {
  const [root, pub] = site({ 'p.md': embed, '../a.ts': 'x\n' })
  const p = checkRegions(root, pub)
  expect(p).toHaveLength(1); expect(p[0]).toContain('a.ts'); expect(p[0]).toContain('pod')
})
test('a missing file names the file', () => {
  const [root, pub] = site({ 'p.md': embed })
  const p = checkRegions(root, pub)
  expect(p).toHaveLength(1); expect(p[0]).toContain('a.ts')
})
test('a whole-file embed needs only the file', () => {
  const [root, pub] = site({ 'p.md': '<<< @/../x.json\n', '../x.json': '{}' })
  expect(checkRegions(root, pub)).toEqual([])
})
test('Open in nano needs its nano.json in the public dir', () => {
  const md = '<OpenInNano src="examples/x/nano.json"/>\n'
  const [root, pub] = site({ 'p.md': md })
  const p = checkRegions(root, pub)
  expect(p).toHaveLength(1); expect(p[0]).toContain('examples/x/nano.json')
  const [root2, pub2] = site({ 'p.md': md }, { 'examples/x/nano.json': '{}' })
  expect(checkRegions(root2, pub2)).toEqual([])
})
test('a region whose name only starts with the wanted one is not it', () => {
  const [root, pub] = site({ 'p.md': embed, '../a.ts': '// #region pod-extra\nx\n// #endregion pod-extra\n' })
  expect(checkRegions(root, pub)).toHaveLength(1)
})
test('a region closed by a bare #endregion is not one (VitePress would embed the whole file)', () => {
  const [root, pub] = site({ 'p.md': embed, '../a.ts': '// #region pod\nx\n// #endregion\n' })
  expect(checkRegions(root, pub)).toHaveLength(1)
})
