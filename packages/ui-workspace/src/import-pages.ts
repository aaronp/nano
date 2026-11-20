/**
 * An import's pages into the Platform. `withImported` is the workspace's rule for them (it was the page store's
 * `merge`): a free id is added as it is (last in order); a taken id with identical content skipped, so a repeat is a
 * no-op; a taken id with other content added under the next free `-2`, `-3`…; the incoming Main (`workspace`) fills
 * Main when Main shows only views (after New, say), else it is a page beside it. `importing` wraps the host's
 * `importUrl`: the file's pages (a bundle's, or a nano.json's old layout migrated), edited as the Import dialog chose
 * (`chosen.pages`), are applied with the app.
 *
 *   platform.apply(withImported(platform.document().doc, incoming))
 *   host.importUrl = importing(host.importUrl.bind(host), platform)
 */
import type { NanoResult } from '@pritzlaff/nano-core'
import type { Page, Platform, UIDeployment } from '@pritzlaff/nano-platform'
import type { Host } from './host.ts'
import { opened } from './migrate.ts'
import { showStatus } from './lib/status.ts'

const MAIN = 'workspace'
const order = (p: Page) => { const o = (p.meta as { order?: unknown } | undefined)?.order; return typeof o === 'number' ? o : Infinity }
/** A page as compared: without its place in the order. */
const body = (p: Page) => { const { order: _, ...meta } = (p.meta ?? {}) as Record<string, unknown>; return JSON.stringify({ ...p, meta }) }

/** `current` with `incoming`'s pages, by the workspace's rules. Pure. */
export function withImported(current: UIDeployment, incoming: UIDeployment): UIDeployment {
  const pages = { ...current.pages }
  let last = Math.max(0, ...Object.values(pages).map(order).filter(Number.isFinite))
  for (const [id, p] of Object.entries(incoming.pages).sort(([, a], [, b]) => order(a) - order(b))) {
    const same = pages[id]
    if (same && body(same) === body(p)) continue
    const fills = id === MAIN && !!same && Object.values(same.slots).every(s => s.kind === 'view')
    let at = id
    for (let n = 2; !fills && pages[at]; n++) at = `${id}-${n}`
    pages[at] = { ...p, meta: { ...(p.meta as object), order: fills ? order(same!) : ++last } }
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
    const r = platform.apply(withImported(platform.document().doc, chosen?.pages ? chosen.pages(read.value.pages) : read.value.pages))
    if (!r.ok) showStatus(document, r.fail.reason)
    return done
  }
