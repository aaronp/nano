/**
 * The workspace's rules for its pages, which are the Platform's (ADR-0038): Main (`MAIN`) is always there and first; a
 * page's id never changes (a rename sets its `title`) and is its route (`routeOf`: `/p/<id>` for one of the workspace's
 * own routes, `FIXED`, which another client may have used; the workspace never makes one); the rest are in the
 * workspace's own meta (`meta.workspace`, ADR-0039: `order`, `icon`, Save layout's restore point). The workspace builds each page edit as a `next` and gives it to `applyPages`,
 * which checks these rules (`refusal`, as the pod `platform` does) before the Platform's `apply`.
 *
 *   ordered(doc)                                   // ['workspace', …the rest by meta.workspace.order]
 *   applyPages(platform, moved(doc, 'two', 1)!)    // a reorder: each order that changes rewritten
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

type Meta = { icon?: string; order?: number; [k: string]: unknown }
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** A page's own meta of the workspace (`meta.workspace`: icon, order, Save layout's restore point); `{}` if it is none. */
export const metaOf = (p: Page | undefined): Meta => (obj(p?.meta) && obj(p.meta['workspace']) ? p.meta['workspace'] : {}) as Meta
/** Page `p` with `m` as the workspace's own meta; other clients' meta kept. */
export const withMeta = (p: Page, m: Meta): Page => ({ ...p, meta: { ...(obj(p.meta) ? p.meta : {}), workspace: m } })

/** The page ids in nav order: Main, then by order (a page without one last). */
export const ordered = (doc: Outline): string[] => {
  const at = (id: string) => metaOf(doc.pages[id]).order ?? Infinity
  return Object.keys(doc.pages).sort((a, b) => (a === MAIN ? -1 : b === MAIN ? 1 : at(a) - at(b) || 0))
}

/** `doc` with page `id` at place `to` of `ordered(doc)`, each page whose place changed given it as its order;
 * undefined for Main, Main's place, a place past the end or an unknown page. */
export function moved(doc: Outline, id: string, to: number): Outline | undefined {
  const ids = ordered(doc).filter((x) => x !== id)
  if (id === MAIN || !doc.pages[id] || to < 1 || to > ids.length) return undefined
  ids.splice(to, 0, id)
  return { ...doc, pages: Object.fromEntries(Object.entries(doc.pages).map(([p, page]) => {
    const i = ids.indexOf(p), m = metaOf(page)
    return [p, m.order === i ? page : withMeta(page, { ...m, order: i })]
  })) }
}

/** Why `next` breaks the workspace's rules, coming from `was`: Main dropped, or a page added on a fixed route. */
export function refusal(was: Outline, next: Outline): string | undefined {
  if (!next.pages[MAIN]) return `Main (the page ${MAIN}) is not removed`
  const fixed = Object.keys(next.pages).find((id) => FIXED.includes(id) && !(id in was.pages))
  return fixed && `${fixed} is the workspace's own route, not a page`
}

/** The workspace's own page edit: `next` refused (`invalid-input`) if it breaks the rules, else the Platform's `apply`. */
export function applyPages(platform: ReturnType<typeof Outline.create>, next: Outline): NanoResult<void> {
  const why = refusal(platform.document().doc, next)
  return why ? failure('invalid-input', why) : platform.apply(next)
}
