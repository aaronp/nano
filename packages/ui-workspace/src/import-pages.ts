/**
 * An import's pages into the Platform. `withImported` is the workspace's rule for them (it was the page store's
 * `merge`): a free id is added as it is (last in order); a taken id with identical content skipped, so a repeat is a
 * no-op; a taken id with other content, or one of the workspace's own routes (`FIXED`), added under the next free
 * `-2`, `-3`…; the incoming Main (`workspace`) fills Main when Main shows only views (after New, say), else it is a
 * page beside it. `importing` wraps the host's
 * `importUrl`: the file's pages (a bundle's, or a nano.json's old layout migrated), edited as the Import dialog chose
 * (`chosen.pages`), are applied with the app; a plain nano.json's Main filling Main keeps Main's title, icon and view
 * slots (and its layout, when the file's Main has none).
 *
 *   applyPages(platform, withImported(platform.document().doc, incoming))   // the workspace's rules checked first
 *   host.importUrl = importing(host.importUrl.bind(host), platform)
 */
import type { NanoResult } from '@pritzlaff/nano-core'
import type { Page, Platform, UIDeployment } from '@pritzlaff/nano-platform'
import type { Host } from './host.ts'
import { opened } from './migrate.ts'
import { showStatus } from './lib/status.ts'
import { applyPages, FIXED, MAIN, metaOf, withMeta } from './lib/pages.ts'

const order = (p: Page) => { const o = metaOf(p).order; return typeof o === 'number' ? o : Infinity }
/** A page as compared: without its place in the order. */
const body = (p: Page) => { const { order: _, ...m } = metaOf(p); return JSON.stringify(withMeta(p, m)) }

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** `mine`'s keys of other clients, with `from`'s `workspace` key (if any); undefined if that leaves none. */
const ours = (mine: unknown, from: unknown) => {
  const { workspace: _, ...o } = obj(mine) ? mine : {}, w = obj(from) && 'workspace' in from ? { ...o, workspace: from['workspace'] } : o
  return Object.keys(w).length ? w : undefined
}
/** `p` filling Main (`was`): its title, slots and the workspace's keys; Main's other clients' `layout` and `meta` keys kept. */
const filling = (was: Page, p: Page): Page => {
  const layout = ours(was.layout, p.layout), meta = ours(was.meta, p.meta)
  return { ...(p.title !== undefined && { title: p.title }), slots: p.slots, ...(layout && { layout }), ...(meta && { meta }) }
}

/** `current` with `incoming`'s pages, by the workspace's rules. Pure. */
export function withImported(current: UIDeployment, incoming: UIDeployment): UIDeployment {
  const pages = { ...current.pages }
  let last = Math.max(0, ...Object.values(pages).map(order).filter(Number.isFinite))
  for (const [id, p] of Object.entries(incoming.pages).sort(([, a], [, b]) => order(a) - order(b))) {
    const same = pages[id]
    if (same && body(same) === body(p)) continue
    const fills = id === MAIN && !!same && Object.values(same.slots).every(s => s.kind === 'view')
    let at = id   // one of the workspace's own routes is taken too
    for (let n = 2; !fills && (pages[at] || FIXED.includes(at)); n++) at = `${id}-${n}`
    pages[at] = withMeta(fills ? filling(same!, p) : p, { ...metaOf(p), order: fills ? order(same!) : ++last })
  }
  return { pages }
}

type Chosen = Parameters<Host['importUrl']>[1] & { pages?(p: UIDeployment): UIDeployment }

/** `importUrl`, then the file's pages applied (`withImported`); a refusal is a status. */
export const importing = (importUrl: Host['importUrl'], platform: ReturnType<typeof Platform.create>) =>
  async (url: string, chosen?: Chosen): Promise<NanoResult<void>> => {
    // ponytail: the file is fetched again here (importApp fetched it for the app); fold into one fetch if it matters
    const file = await fetch(url).then(r => r.json()).catch(() => undefined)
    const done = await importUrl(url, chosen)
    const read = done.ok && file !== undefined ? opened(file) : undefined
    if (!read?.ok) return done
    const was = platform.document().doc, next = withImported(was, chosen?.pages ? chosen.pages(read.value.pages) : read.value.pages)
    const legacy = !(typeof file === 'object' && file !== null && 'platform' in file), main = next.pages[MAIN], prev = was.pages[MAIN]
    // a plain nano.json's Main has no title of its own ("Workspace"): filling Main, it keeps Main's title, icon, view slots (the explorer) and, without its own, layout
    if (legacy && main && prev && main !== prev) {
      const views = Object.fromEntries(Object.entries(prev.slots).filter(([, s]) => s.kind === 'view'))
      const engine = (p: Page) => (obj(p.layout) ? p.layout['workspace'] : undefined)
      next.pages[MAIN] = withMeta({ ...main, ...(prev.title !== undefined && { title: prev.title }), slots: { ...views, ...main.slots }, ...(engine(main) === undefined && engine(prev) !== undefined && { layout: { ...(obj(main.layout) && main.layout), workspace: engine(prev) } }) },
        { ...metaOf(main), icon: metaOf(prev).icon })
    }
    const r = applyPages(platform, next)
    if (!r.ok) showStatus(document, r.fail.reason)
    return done
  }
