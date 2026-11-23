/**
 * The workspace's rules for its pages, which are the Outline's (ADR-0040): Main (`MAIN`) is always there and the first
 * root (it may have children); a page's id never changes (a rename sets its `title`, a move edits lists) and is its
 * route (`routeOf`: `/p/<id>`); order is the tree (`walk`); the rest are in the workspace's own meta (`meta.workspace`,
 * ADR-0039: `icon`, Save layout's restore point). The workspace builds each page edit as a `next` and gives it to
 * `applyPages`, which checks these rules (`refusal`, as the pod `outline` does) before the Outline's `apply`.
 *
 *   walk(doc)                                       // ['workspace', …each page, depth first]
 *   applyPages(outline, move(doc, 'two', 'one', 0)!) // two the first child of one; without(doc, 'one') removes its subtree
 *   slugPath('Trading', taken).slice(1)             // a new page's id
 */
import { failure, type NanoResult } from '@pritzlaff/nano-core'
import type { Page, Outline } from '@pritzlaff/nano-outline'
import { movePage, removePage, type Host } from '@pritzlaff/nano-host'

/** Main's id (and route). */
export const MAIN = 'workspace'

/** A route for a title: `/` + lower-case dashes, `-2`, `-3`… until it is not in `taken`. A page's id is this without the `/`. */
export const slugPath = (title: string, taken: readonly string[]): string => {
  const base = '/' + (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace-page')
  let path = base
  for (let n = 2; taken.includes(path); n++) path = `${base}-${n}`
  return path
}

/** A page's route: `/p/<id>`, so it never meets one of the app's own screens. */
export const routeOf = (id: string): string => `/p/${id}`

type Meta = { icon?: string; [k: string]: unknown }
/** A plain object (not null, not an array). */
export const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** A page's own meta of the workspace (`meta.workspace`: icon, Save layout's restore point); `{}` if it is none. */
export const metaOf = (p: Page | undefined): Meta => (obj(p?.meta) && obj(p.meta['workspace']) ? p.meta['workspace'] : {}) as Meta
/** Page `p` with `m` as the workspace's own meta; other clients' meta kept; no `meta.workspace` (nor `meta`) left empty. */
export const withMeta = (p: Page, m: Meta): Page => {
  const { workspace: _, ...others } = obj(p.meta) ? p.meta : {}, { meta: _m, ...rest } = p
  const set = Object.values(m).some((v) => v !== undefined)   // an `m` of nothing but undefined is none
  const meta = { ...others, ...(set && { workspace: m }) }
  return Object.keys(meta).length ? { ...rest, meta } : rest
}

/** The page ids in tree order: depth first, each list in order (Main, the first root, first). */
export const walk = (doc: Outline, ids = doc.roots): string[] => ids.flatMap((id) => [id, ...walk(doc, doc.pages[id]?.children ?? [])])
/** Page `parent`'s children in order; undefined: the roots ([] for a leaf or an unknown page). */
export const childrenOf = (doc: Outline, parent: string | undefined): string[] => (parent === undefined ? doc.roots : doc.pages[parent]?.children ?? [])
/** Page `id`'s parent; undefined for a root (or a page not in the tree). */
export const parentOf = (doc: Outline, id: string): string | undefined => Object.keys(doc.pages).find((p) => doc.pages[p]!.children?.includes(id))
/** Page `id` and every page below it, in tree order. */
export const subtree = (doc: Outline, id: string): string[] => walk(doc, [id])
/** The host core's `movePage`, behind the Main rule: undefined for Main or for Main's place (index 0 of the roots). */
export const move = (doc: Outline, id: string, parent: string | undefined, index: number): Outline | undefined =>
  id === MAIN || (parent === undefined && index < 1) ? undefined : movePage(doc, id, parent, index)

/** The host core's `removePage` (the page and its subtree), behind the Main rule: undefined for Main. */
export const without = (doc: Outline, id: string): Outline | undefined => (id === MAIN ? undefined : removePage(doc, id))

/** Why `next` breaks the workspace's rules: Main dropped or not the first root. */
export function refusal(next: Outline): string | undefined {
  if (!next.pages[MAIN]) return `Main (the page ${MAIN}) is not removed`
  if (next.roots[0] !== MAIN) return `Main (the page ${MAIN}) stays the first page`
  return undefined
}

/** The workspace's own page edit: `next` refused (`invalid-input`) if it breaks the rules, else the Outline's `apply`. */
export function applyPages(outline: Host['outline'], next: Outline): NanoResult<void> {
  const why = refusal(next)
  return why ? failure('invalid-input', why) : outline.apply(next)
}
