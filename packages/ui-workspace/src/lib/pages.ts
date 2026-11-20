/**
 * The workspace's rules for its pages, which are the Outline's (ADR-0040): Main (`MAIN`) is always there and the first
 * root (it may have children); a page's id never changes (a rename sets its `title`, a move edits lists) and is its
 * route (`routeOf`: `/p/<id>` for one of the workspace's own routes, `FIXED`, which another client may have used; the
 * workspace never makes one); order is the tree (`walk`); the rest are in the workspace's own meta (`meta.workspace`,
 * ADR-0039: `icon`, Save layout's restore point). The workspace builds each page edit as a `next` and gives it to
 * `applyPages`, which checks these rules (`refusal`, as the pod `outline` does) before the Outline's `apply`.
 *
 *   walk(doc)                                       // ['workspace', …each page, depth first]
 *   applyPages(outline, move(doc, 'two', 'one', 0)!) // two the first child of one; without(doc, 'one') removes its subtree
 *   slugPath('Trading', taken).slice(1)             // a new page's id
 */
import { failure, type NanoResult } from '@pritzlaff/nano-core'
import type { Page, Outline } from '@pritzlaff/nano-outline'

/** Main's id (and route). */
export const MAIN = 'workspace'
/** The workspace's own routes: never a page's id. */
export const FIXED = ['ring', 'desk', 'settings', 'systems', 'messages', 'components', 'themes', 'inbox']

/** A route for a title: `/` + lower-case dashes, `-2`, `-3`… until it is not in `taken`. A page's id is this without the `/`. */
export const slugPath = (title: string, taken: readonly string[]): string => {
  const base = '/' + (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace-page')
  let path = base
  for (let n = 2; taken.includes(path); n++) path = `${base}-${n}`
  return path
}

/** A page's route: `/<id>`, or `/p/<id>` for an id that is one of the workspace's own routes. */
export const routeOf = (id: string): string => (FIXED.includes(id) ? `/p/${id}` : `/${id}`)

type Meta = { icon?: string; [k: string]: unknown }
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** A page's own meta of the workspace (`meta.workspace`: icon, Save layout's restore point); `{}` if it is none. */
export const metaOf = (p: Page | undefined): Meta => (obj(p?.meta) && obj(p.meta['workspace']) ? p.meta['workspace'] : {}) as Meta
/** Page `p` with `m` as the workspace's own meta; other clients' meta kept; no `meta.workspace` (nor `meta`) left empty. */
export const withMeta = (p: Page, m: Meta): Page => {
  const { workspace: _, ...others } = obj(p.meta) ? p.meta : {}, { meta: _m, ...rest } = p, meta = { ...others, ...(Object.values(m).some((v) => v !== undefined) && { workspace: m }) }
  return Object.keys(meta).length ? { ...rest, meta } : rest
}

/** The page ids in tree order: depth first, each list in order (Main, the first root, first). */
export const walk = (doc: Outline, ids = doc.roots): string[] => ids.flatMap((id) => [id, ...walk(doc, doc.pages[id]?.children ?? [])])
/** Page `id`'s parent; undefined for a root (or a page not in the tree). */
export const parentOf = (doc: Outline, id: string): string | undefined => Object.keys(doc.pages).find((p) => doc.pages[p]!.children?.includes(id))
/** Page `id` and every page below it, in tree order. */
export const subtree = (doc: Outline, id: string): string[] => walk(doc, [id])
/** `doc` with only the listed ids (roots, children) that `keep`; a page whose list is unchanged kept as it is. */
const unlisted = (doc: Outline, keep: (id: string) => boolean): Outline => ({ roots: doc.roots.filter(keep), pages: Object.fromEntries(Object.entries(doc.pages).map(([id, p]) => {
  const c = p.children?.filter(keep)
  return [id, c && c.length !== p.children!.length ? { ...p, children: c } : p]
})) })

/** `doc` with page `id` at `index` of `parent`'s children (undefined: the roots), counted without it; undefined for
 * Main, Main's place, an unknown page or parent, a parent in `id`'s subtree or an index past the end. */
export function move(doc: Outline, id: string, parent: string | undefined, index: number): Outline | undefined {
  if (id === MAIN || !Object.hasOwn(doc.pages, id) || (parent !== undefined && (!Object.hasOwn(doc.pages, parent) || subtree(doc, id).includes(parent)))) return undefined
  const out = unlisted(doc, (x) => x !== id), list = parent === undefined ? out.roots : out.pages[parent]!.children ?? []
  if (index < (parent === undefined ? 1 : 0) || index > list.length) return undefined
  const to = [...list.slice(0, index), id, ...list.slice(index)]
  return parent === undefined ? { ...out, roots: to } : { ...out, pages: { ...out.pages, [parent]: { ...out.pages[parent]!, children: to } } }
}

/** `doc` without page `id` and its subtree (from the pages and its parent's list); undefined for Main or an unknown page. */
export function without(doc: Outline, id: string): Outline | undefined {
  if (id === MAIN || !Object.hasOwn(doc.pages, id)) return undefined
  const gone = new Set(subtree(doc, id)), out = unlisted(doc, (x) => !gone.has(x))
  return { ...out, pages: Object.fromEntries(Object.entries(out.pages).filter(([p]) => !gone.has(p))) }
}

/** Why `next` breaks the workspace's rules, coming from `was`: Main dropped, not the first root, or a page added on a fixed route. */
export function refusal(was: Outline, next: Outline): string | undefined {
  if (!next.pages[MAIN]) return `Main (the page ${MAIN}) is not removed`
  if (next.roots[0] !== MAIN) return `Main (the page ${MAIN}) stays the first page`
  const fixed = Object.keys(next.pages).find((id) => FIXED.includes(id) && !(id in was.pages))
  return fixed && `${fixed} is the workspace's own route, not a page`
}

/** The workspace's own page edit: `next` refused (`invalid-input`) if it breaks the rules, else the Outline's `apply`. */
export function applyPages(outline: ReturnType<typeof Outline.create>, next: Outline): NanoResult<void> {
  const why = refusal(outline.document().doc, next)
  return why ? failure('invalid-input', why) : outline.apply(next)
}
