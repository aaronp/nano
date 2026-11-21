/**
 * Page edits (spec §3): pure functions from an Outline to the next one, for `host.outline.apply`; undefined when the
 * edit does not apply (an unknown page or slot, a move into its own subtree or past the end). Each keeps the tree.
 * A new page's id comes from its title (lower-case dashes, `-2`, `-3`… until free); a new slot's from its pod's name,
 * its tool or `select`, the same way. The new page is the last of its list, the new slot the last of its page's.
 *
 *   addPage(o, 'Trading', 'home')     // 'trading' the last child of home (no parent: the last root)
 *   movePage(o, 'trading', undefined, 0)   // the first root; removePage(o, 'trading') removes its subtree
 */
import type { Outline, Page, Slot } from '@pritzlaff/nano-outline'

const free = (base: string, taken: (id: string) => boolean) => { let id = base; for (let n = 2; taken(id); n++) id = `${base}-${n}`; return id }
const slug = (s: string, none: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || none
const has = (o: Outline, id: string | undefined) => id !== undefined && Object.hasOwn(o.pages, id)
/** Page `id`'s children (undefined: the roots). */
const listOf = (o: Outline, parent: string | undefined) => (parent === undefined ? o.roots : o.pages[parent]!.children ?? [])
/** `o` with `parent`'s list (undefined: the roots) set to `ids`. */
const withList = (o: Outline, parent: string | undefined, ids: string[]): Outline =>
  parent === undefined ? { ...o, roots: ids } : { ...o, pages: { ...o.pages, [parent]: { ...o.pages[parent]!, children: ids } } }
/** `o` with page `id` replaced by `f` of it. */
const withPage = (o: Outline, id: string, f: (p: Page) => Page | undefined): Outline | undefined => {
  const p = has(o, id) ? f(o.pages[id]!) : undefined
  return p && { ...o, pages: { ...o.pages, [id]: p } }
}
/** Page `id` and every page below it. */
const subtree = (o: Outline, id: string): string[] => [id, ...(o.pages[id]?.children ?? []).flatMap(c => subtree(o, c))]
/** `o` without page `id` in any list. */
const unlisted = (o: Outline, id: string): Outline => ({
  roots: o.roots.filter(x => x !== id),
  pages: Object.fromEntries(Object.entries(o.pages).map(([k, p]) => [k, p.children?.includes(id) ? { ...p, children: p.children.filter(x => x !== id) } : p])),
})

/** A new empty page titled `title`, the last child of `parent` or (none) the last root. */
export function addPage(o: Outline, title: string, parent?: string): Outline | undefined {
  if (parent !== undefined && !has(o, parent)) return undefined
  const id = free(slug(title, 'page'), s => Object.hasOwn(o.pages, s))
  return withList({ ...o, pages: { ...o.pages, [id]: { slots: {}, title } } }, parent, [...listOf(o, parent), id])
}

/** `o` without page `id` and its subtree. */
export function removePage(o: Outline, id: string): Outline | undefined {
  if (!has(o, id)) return undefined
  const gone = new Set(subtree(o, id)), out = unlisted(o, id)
  return { ...out, pages: Object.fromEntries(Object.entries(out.pages).filter(([p]) => !gone.has(p))) }
}

/** Page `id` at `index` of `parent`'s children (undefined: the roots), counted without it. */
export function movePage(o: Outline, id: string, parent: string | undefined, index: number): Outline | undefined {
  if (!has(o, id) || (parent !== undefined && (!has(o, parent) || subtree(o, id).includes(parent)))) return undefined
  const out = unlisted(o, id), list = listOf(out, parent)
  if (!Number.isInteger(index) || index < 0 || index > list.length) return undefined
  return withList(out, parent, [...list.slice(0, index), id, ...list.slice(index)])
}

export const retitle = (o: Outline, id: string, title: string) => withPage(o, id, p => ({ ...p, title }))

/** `slot` added to page `page`, under a free id. */
export const addSlot = (o: Outline, page: string, slot: Slot) => withPage(o, page, p => {
  const base = slot.kind === 'pod' ? slot.pod.pod : slot.kind === 'tool' ? slot.tool : 'select'
  return { ...p, slots: { ...p.slots, [free(slug(base, 'slot'), s => Object.hasOwn(p.slots, s))]: slot } }
})

export const removeSlot = (o: Outline, page: string, slot: string) =>
  withPage(o, page, p => { if (!Object.hasOwn(p.slots, slot)) return undefined; const { [slot]: _, ...rest } = p.slots; return { ...p, slots: rest } })
