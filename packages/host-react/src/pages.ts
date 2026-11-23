/**
 * The host core's page edits applied to the live outline (on the version they were made from), and what the React
 * host reads off a page: its tabs per level, its title, its columns (`layout.react`, ADR-0039: other clients' keys kept).
 *
 *   edit(h, o => removeSlot(o, 'home', 'log1'))   // success, or why not
 */
import { failure, success, type NanoResult } from '@pritzlaff/nano-core'
import type { Outline, Page } from '@pritzlaff/nano-outline'
import { addPage, type Host } from '@pritzlaff/nano-host'

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** `f` of the current outline applied; a failure when `f` does not apply. */
export function edit(h: Host, f: (o: Outline) => Outline | undefined): NanoResult<void> {
  const { doc, version } = h.outline.document(), next = f(doc)
  return next ? h.outline.apply(next, { base: version }) : failure('not-found', 'no such page or slot')
}

/** A new page titled `title` under `parent` (none: a root); its id. */
export function newPage(h: Host, title: string, parent?: string): NanoResult<string> {
  const was = h.outline.document().doc.pages, r = edit(h, o => addPage(o, title, parent))
  return r.ok ? success(Object.keys(h.outline.document().doc.pages).find(id => !(id in was))!) : r
}

/** One row of tabs per level along the path to `page`: the roots, then each page on the path's children (when it has any), with the path's page at each. */
export function levels(doc: Outline, page: string): { ids: string[]; at: string | undefined }[] {
  const path: string[] = []
  for (let p: string | undefined = page; p; p = Object.keys(doc.pages).find(k => doc.pages[k]!.children?.includes(p!))) path.unshift(p)
  return [doc.roots, ...path.map(p => doc.pages[p]?.children ?? [])].map((ids, i) => ({ ids, at: path[i] })).filter(r => r.ids.length)
}

export const titleOf = (id: string, p: Page | undefined) => p?.title ?? id
export const columnsOf = (p: Page | undefined) => {
  const c = obj(p?.layout) && obj(p.layout['react']) ? p.layout['react']['columns'] : undefined
  return typeof c === 'number' && c >= 1 ? c : 2
}

/** Page `id`'s columns in `layout.react`. */
export const setColumns = (h: Host, id: string, columns: number) =>
  edit(h, o => o.pages[id] && { ...o, pages: { ...o.pages, [id]: { ...o.pages[id], layout: { ...(obj(o.pages[id].layout) ? o.pages[id].layout : {}), react: { columns } } } } })
