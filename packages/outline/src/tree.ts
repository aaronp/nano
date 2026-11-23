/**
 * The Outline's tree, internal: `fault` says why a document is not a tree, `movedPages` which pages changed place.
 * Each page has one place: `roots` or one page's `children`.
 *
 *   fault({ roots: ['a'], pages: { a: { slots: {} }, b: { slots: {} } } })   // 'page b: in no list (an orphan)'
 *   movedPages(was, now)                                                      // ['b', 'a'] after roots [a, b] became [b, a]
 */
import type { Outline } from './document.ts'

const ROOTS = ''   // the parent of a root (a page id is never empty)
/** Each listed id, in list order (roots first), with its parent and its siblings' list. */
const places = (doc: Outline): [string, string, string[]][] =>
  [[ROOTS, doc.roots] as const, ...Object.entries(doc.pages).map(([id, p]) => [id, p.children ?? []] as const)]
    .flatMap(([parent, ids]) => ids.map((id): [string, string, string[]] => [id, parent, ids]))

/** Why `doc` is not a tree (a listed id with no page, a page in two places, a cycle, an orphan), naming the page; else undefined. */
export function fault(doc: Outline): string | undefined {
  const seen = new Set<string>(), parents = new Map<string, string>()
  for (const [id, parent] of places(doc)) {
    if (!Object.hasOwn(doc.pages, id)) return `page ${id}: listed in ${parent === ROOTS ? 'roots' : `page ${parent}'s children`} but has no page`
    if (seen.has(id)) return `page ${id}: in more than one place`
    seen.add(id); parents.set(id, parent)
  }
  const orphan = Object.keys(doc.pages).find(id => !seen.has(id))
  if (orphan) return `page ${orphan}: in no list (an orphan)`
  // every page has one place now, so a page not reached from the roots is on a cycle or under one
  const reached = new Set<string>()
  const walk = (ids: string[]) => { for (const id of ids) { reached.add(id); walk(doc.pages[id]!.children ?? []) } }
  walk(doc.roots)
  let at = Object.keys(doc.pages).find(id => !reached.has(id))
  if (at === undefined) return undefined
  const path = new Set<string>()   // up through the parents until one repeats: that one is on the cycle
  while (!path.has(at)) { path.add(at); at = parents.get(at)! }
  return `page ${at}: is its own ancestor`
}

/** The pages in both whose parent changed, or whose position among the siblings kept (same parent in both) changed. */
export function movedPages(was: Outline, now: Outline): string[] {
  const a = new Map(places(was).map(([id, parent, list]) => [id, { parent, list }]))
  const b = new Map(places(now).map(([id, parent, list]) => [id, { parent, list }]))
  const kept = (list: string[]) => list.filter(id => a.get(id)?.parent === b.get(id)?.parent)
  return [...b].filter(([id, y]) => {
    const x = a.get(id)
    return x && (x.parent !== y.parent || kept(x.list).indexOf(id) !== kept(y.list).indexOf(id))
  }).map(([id]) => id)
}
