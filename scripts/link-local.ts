// Points a template's @pritzlaff/nano-{core,runes,elements} at this repo's packages, so it builds against this commit
// rather than the published copies: `bun scripts/link-local.ts <template-dir>...` (after a normal `bun install` there).
import { lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const PACKAGES = ['core', 'runes', 'elements']

/** Replaces `<dir>/node_modules/@pritzlaff/nano-<p>` (a copy or a link) with a relative symlink to `<repo>/packages/<p>`;
 * nothing else in node_modules is touched. Safe to repeat. Returns the links made. */
export function linkLocal(dir: string, repo: string): string[] {
  const scope = join(resolve(dir), 'node_modules', '@pritzlaff')
  mkdirSync(scope, { recursive: true })
  return PACKAGES.map(p => {
    const link = join(scope, `nano-${p}`)
    try { lstatSync(link); rmSync(link, { recursive: true, force: true }) } catch {}   // only the entry we own
    symlinkSync(relative(dirname(link), join(resolve(repo), 'packages', p)), link)
    return link
  })
}

if (import.meta.main) {
  const repo = join(import.meta.dir, '..')
  for (const dir of process.argv.slice(2)) for (const l of linkLocal(dir, repo)) console.log(relative(process.cwd(), l))
}
