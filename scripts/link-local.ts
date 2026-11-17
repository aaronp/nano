// Points a template's @pritzlaff/nano-{core,elements,ui} at this repo's packages, so it builds against this commit
// rather than the published copies: `bun scripts/link-local.ts <template-dir>...` (after a normal `bun install` there).
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/** [packages/ directory, name under @pritzlaff/] */
const PACKAGES = [['nano', 'nano-core'], ['elements', 'nano-elements'], ['ui', 'nano-ui']]

/** Replaces `<dir>/node_modules/@pritzlaff/<name>` (a copy or a link) with a relative symlink to `<repo>/packages/<dir>`;
 * nothing else in node_modules is touched. Safe to repeat. Returns the links made. */
export function linkLocal(dir: string, repo: string): string[] {
  const modules = join(resolve(dir), 'node_modules'), scope = join(modules, '@pritzlaff')
  if (!existsSync(modules)) throw new Error(`${dir}/node_modules does not exist: run bun install there first`)
  mkdirSync(scope, { recursive: true })
  return PACKAGES.map(([p, name]) => {
    const link = join(scope, name)
    let there = true
    try { lstatSync(link) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; there = false }
    if (there) rmSync(link, { recursive: true, force: true })   // only the entry we own; a failure throws
    symlinkSync(relative(dirname(link), join(resolve(repo), 'packages', p)), link)
    return link
  })
}

if (import.meta.main) {
  const repo = join(import.meta.dir, '..')
  for (const dir of process.argv.slice(2)) for (const l of linkLocal(dir, repo)) console.log(relative(process.cwd(), l))
}
