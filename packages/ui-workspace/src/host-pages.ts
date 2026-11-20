/**
 * `workspace.host/pages`: this host's HostPages over the page store (lib/pages.ts), the pod `pages` beside `ui` and
 * `deploy` in `main`, never saved. A call's `setPage` or `removePage` asks `approve` (HostUI's, through the app) with a
 * one-line summary, and anything but a yes within `ms` is `denied`; `pages` and `open` are not asked. The workspace's
 * own UI writes the store directly, unasked. Without a store (a replayed app's own provider) every op is not-found.
 *
 *   ns.provider([hostUi, deploy, hostPages(store, title => askTheUser(title))])   // hostProvider (host-deploy.ts)
 *   { pages: pagesPod }   // placed first in `main` by host.ts
 */
import { Coord, Implementation, failure, provide, success, type NanoResult, type Pod } from '@pritzlaff/nano-core'
import { HostPages, type Page } from '@pritzlaff/nano-ui'
import type { pageStore } from './lib/pages.ts'

const PAGES = Coord.namespace('workspace.host').implementationId('pages')
/** The `pages` pod's data: built on its first call. */
export const pagesPod: Pod = { implementation: PAGES.toString(), eager: false }
/** As `deploy`'s approvals (host-deploy.ts): well under the app's 30 s call timeout. */
const APPROVAL_MS = 20_000

/** `approve(text)`, where anything but a yes within `ms` (a throw, a no, no answer) is false. */
async function yes(approve: (text: string) => Promise<boolean>, text: string, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), ms) })
  return (await Promise.race([approve(text).catch(() => false), late]).finally(() => clearTimeout(timer))) === true
}

export function hostPages(store: ReturnType<typeof pageStore> | undefined, approve: (text: string) => Promise<boolean>, ms = APPROVAL_MS) {
  const none = failure('not-found', 'this app keeps no pages')
  const done = (r: NanoResult<void>): NanoResult<null> => r.ok ? success(null) : r
  const asked = async (text: string, change: () => NanoResult<void>): Promise<NanoResult<null>> =>
    await yes(approve, text, ms) ? done(change()) : failure('denied', `not approved: ${text}`)
  return Implementation.define(PAGES, {
    provides: [HostPages],
    make: () => [provide(HostPages, {
      pages: async () => store ? success(store.list()) : none,
      setPage: async ({ page, index }) => {
        if (!store) return none
        const p = page as Page
        const text = `${store.get(p.id) ? 'Change' : 'Add'} page ${p.title}${index === undefined ? '' : `, moved to place ${index + 1}`}`
        return asked(text, () => store.set(p, index))
      },
      removePage: async ({ id }) => store ? asked(`Remove page ${store.get(id)?.title ?? id}`, () => store.remove(id)) : none,
      open: async ({ id }) => {
        if (!store) return none
        if (!store.get(id)) return failure('not-found', `no page ${id}`)
        location.hash = `#/${id}`
        return success(null)
      },
    })],
  })
}
