// Fails the docs build when a page embeds a code region that is gone, or offers "Open in nano" for a nano.json the host lacks.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const SKIP = new Set(['node_modules', 'cache', 'dist'])
const pages = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    SKIP.has(e.name) ? [] : e.isDirectory() ? pages(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : [])

/** The problems with the pages under `root` (`@` in an embed is `root`); empty when fine. */
export function checkRegions(root: string, publicDir: string): string[] {
  const problems: string[] = []
  for (const page of pages(root)) {
    const text = readFileSync(page, 'utf8'), at = relative(root, page)
    for (const [, path, region] of text.matchAll(/<<<\s+@\/(\S+?)(?:#([\w-]+))?(?=[\s{[]|$)/gm)) {
      const file = resolve(root, path)
      if (!existsSync(file)) { problems.push(`${at}: ${path} not found`); continue }
      // VitePress closes a region only at `// #endregion <name>`; a bare `#endregion` embeds the whole file.
      const marker = (tag: string) => new RegExp(`^\\s*//\\s*#${tag} ${region}\\s*$`, 'm').test(readFileSync(file, 'utf8'))
      if (region && !(marker('region') && marker('endregion')))
        problems.push(`${at}: ${path} has no region ${region} (// #region ${region} … // #endregion ${region})`)
    }
    for (const [, src] of text.matchAll(/<OpenInNano\s+src="([^"]+)"/g))
      if (!existsSync(join(publicDir, src))) problems.push(`${at}: ${src} not in ${publicDir}`)
  }
  return problems
}

if (import.meta.main) {
  const problems = checkRegions(resolve(import.meta.dir, '..'), resolve(import.meta.dir, '../../packages/ui-workspace/public'))
  for (const p of problems) console.error(p)
  process.exit(problems.length ? 1 : 0)
}
