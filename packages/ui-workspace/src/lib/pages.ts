/**
 * The page store: the run-time truth for the layout's pages (nano-ui's `Page`), in nav order. Main (`workspace`) is
 * always there and first; a page's id never changes (a rename sets its title). `layout.pages` is written from it.
 *
 *   const pages = pageStore(pagesOf(doc.layout), (runtime, pod) => placedIn(runtime, pod))
 *   pages.set({ id: slugPath('Trading', taken).slice(1), title: 'Trading', slots: [] })   // adds; by id it replaces
 *   pages.prune(placed)   // on `applied`: pod slots whose pod went, gone from every page
 *   pages.merge(importedPages)   // an import's pages: new ids added, identical ones skipped, clashes suffixed
 */
import { failure, success, type NanoResult } from '@pritzlaff/nano-core'
import { pagesOf, type LayoutSlot, type Page } from '@pritzlaff/nano-ui'

/** A route for a title: `/` + lower-case dashes, `-2`, `-3`… until it is not in `taken`. A page's id is this without the `/`. */
export const slugPath = (title: string, taken: readonly string[]): string => {
  const base = '/' + (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace-page')
  let path = base
  for (let n = 2; taken.includes(path); n++) path = `${base}-${n}`
  return path
}
/** Where a page's dock keeps its layout until the page holds it. */
export const layoutKey = (mainKey: string, path: string) => `${mainKey}.saved.${path}`

type Placed = (runtime: string, pod: string) => boolean
const MAIN = 'workspace'
/** The workspace's own routes: never a page's id. */
const FIXED = ['ring', 'desk', 'settings', 'systems', 'messages', 'components', 'themes', 'inbox']
const isPod = (s: Page['slots'][number]): s is LayoutSlot => 'pod' in s

export function pageStore(initial: Page[], placed: Placed) {
  // a bad page dropped (and warned, by pagesOf), a fixed route's too, the first of an id kept
  const given = structuredClone(pagesOf({ pages: initial })).filter((p, i, all) => !FIXED.includes(p.id) && all.findIndex(q => q.id === p.id) === i)
  let pages: Page[] = [given.find(p => p.id === MAIN) ?? { id: MAIN, title: 'Workspace', slots: [] }, ...given.filter(p => p.id !== MAIN)]
  const heard = new Set<() => void>()
  const changed = () => { for (const fn of heard) fn() }
  const bad = (reason: string) => failure('invalid-input', reason)
  const store = {
    list: (): Page[] => structuredClone(pages),
    get: (id: string): Page | undefined => structuredClone(pages.find(p => p.id === id)),
    /** Adds `page`, or replaces the page with its id; `index` moves it there (Main stays first). */
    set(page: Page, index?: number): NanoResult<void> {
      if (FIXED.includes(page.id)) return bad(`${page.id} is the workspace's own route, not a page`)
      if (pagesOf({ pages: [page] }).length !== 1) return bad(`not a page: ${page.id}`)
      const missing = page.slots.filter(isPod).find(s => !placed(s.runtime, s.pod))
      if (missing) return bad(`${missing.pod} is not placed in ${missing.runtime}`)
      if (index !== undefined && (page.id === MAIN ? index !== 0 : index === 0)) return bad('Main stays first')
      const at = pages.findIndex(p => p.id === page.id), next = pages.filter(p => p.id !== page.id)
      const to = page.id === MAIN ? 0 : index ?? (at < 0 ? next.length : at)
      next.splice(Math.min(to, next.length), 0, structuredClone(page))
      pages = next
      changed()
      return success(undefined)
    },
    remove(id: string): NanoResult<void> {
      if (id === MAIN) return bad('Main is not removed')
      if (FIXED.includes(id)) return bad(`${id} is the workspace's own route, not a page`)
      if (!pages.some(p => p.id === id)) return failure('not-found', `no page ${id}`)
      pages = pages.filter(p => p.id !== id)
      changed()
      return success(undefined)
    },
    /** Drops the pod slots (and their geometry) whose pod is not `now` placed; whether anything changed. */
    prune(now: Placed = placed): boolean {
      let any = false
      pages = pages.map(p => {
        const gone = p.slots.filter(s => isPod(s) && !now(s.runtime, s.pod)).map(s => s.id)
        if (!gone.length) return p
        any = true
        const { geometry: was, ...rest } = p, geometry = Object.entries(was ?? {}).filter(([id]) => !gone.includes(id))
        return { ...rest, slots: p.slots.filter(s => !gone.includes(s.id)), ...(geometry.length && { geometry: Object.fromEntries(geometry) }) }
      })
      if (any) changed()
      return any
    },
    subscribe(fn: () => void): () => void { heard.add(fn); return () => { heard.delete(fn) } },
    /**
     * Adds an import's pages: a free id as it is; a taken id with identical content (title, icon, slots, engine keys)
     * skipped, so a repeat is a no-op; a taken id with other content added under the next free `-2`, `-3`… The
     * incoming `workspace` is never Main (its id is taken). Returns `set`'s refusals, one message each.
     */
    merge(incoming: Page[]): string[] {
      const refused: string[] = [], body = (p: Page) => JSON.stringify({ ...p, id: '' })
      for (const p of structuredClone(incoming)) {
        const same = pages.find(q => q.id === p.id)
        if (same && body(same) === body(p)) continue
        let id = p.id
        for (let n = 2; pages.some(q => q.id === id); n++) id = `${p.id}-${n}`
        const r = store.set({ ...p, id })
        if (!r.ok) refused.push(r.fail.reason)
      }
      return refused
    },
  }
  return store
}
