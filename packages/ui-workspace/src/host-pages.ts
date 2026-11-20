/**
 * `workspace.host/pages`: this host's HostPages over the page store (lib/pages.ts), the pod `pages` beside `ui` and
 * `deploy` in `main`, never saved. A call's `setPage` or `removePage` asks `approve` (HostUI's through the app, timed by
 * hostProvider) with a one-line summary (the pod-supplied title quoted, and what the page shows), and anything but a yes is `denied`; `pages` and `open` are not asked. The
 * workspace's own UI writes the store directly, unasked. Without a store (a replayed app's provider) every op is not-found.
 *
 *   ns.provider([hostUi, deploy, hostPages(store, timed(askTheUser))])   // hostProvider (host-deploy.ts)
 *   { pages: pagesPod }   // placed first in `main` by host.ts
 */
import { Coord, Implementation, failure, provide, success, type NanoResult, type Pod } from '@pritzlaff/nano-core'
import { HostPages, type Page } from '@pritzlaff/nano-ui'
import type { pageStore } from './lib/pages.ts'

const PAGES = Coord.namespace('workspace.host').implementationId('pages')
/** The `pages` pod's data: built on its first call. */
export const pagesPod: Pod = { implementation: PAGES.toString(), eager: false }
export function hostPages(store: ReturnType<typeof pageStore> | undefined, approve: (text: string) => Promise<boolean>) {
  const none = failure('not-found', 'this app keeps no pages')
  const done = (r: NanoResult<void>): NanoResult<null> => r.ok ? success(null) : r
  const asked = async (text: string, change: () => NanoResult<void>): Promise<NanoResult<null>> =>
    await approve(text).catch(() => false) ? done(change()) : failure('denied', `not approved: ${text}`)
  return Implementation.define(PAGES, {
    provides: [HostPages],
    make: () => [provide(HostPages, {
      pages: async () => store ? success(store.list()) : none,
      setPage: async ({ page, index }) => {
        if (!store) return none
        const p = page as Page
        const shows = p.slots.map(s => 'pod' in s ? s.pod : s.view).join(', ') || 'nothing'   // what the page would show, as the call says
        const text = `${store.get(p.id) ? 'Change' : 'Add'} page "${p.title}" showing ${shows}${index === undefined ? '' : `, moved to place ${index + 1}`}`
        return asked(text, () => store.set(p, index))
      },
      removePage: async ({ id }) => store ? asked(`Remove page "${store.get(id)?.title ?? id}"`, () => store.remove(id)) : none,
      open: async ({ id }) => {
        if (!store) return none
        if (!store.get(id)) return failure('not-found', `no page ${id}`)
        location.hash = `#/${id}`
        return success(null)
      },
    })],
  })
}
