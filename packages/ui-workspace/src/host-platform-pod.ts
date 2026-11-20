/**
 * `workspace.host/platform`: this host's HostPlatform over its Platform (boot-host.ts), the pod `platform` beside `ui` and
 * `deploy` in `main`, never saved. `document` gives the pages, written, at their version, unasked. `apply({ next, base })`
 * is refused when `base` is stale ("the pages changed since") or `next` is malformed, else asks `approve` (HostUI's
 * through the app, timed by hostProvider) with a summary of the pages and slots added or removed; anything but a yes is
 * `denied`, a yes applies `next` at `base`. The workspace's own edits apply unasked. Without a Platform (a replayed
 * app's provider) both are not-found.
 *
 *   ns.provider([hostUi, deploy, hostPlatform(() => platform, timed(askTheUser))])   // hostProvider (host-deploy.ts)
 *   { platform: platformPod }   // placed first in `main` by host.ts
 */
import { Coord, Implementation, failure, provide, success, type NanoResult, type Pod } from '@pritzlaff/nano-core'
import { HostPlatform, Platform, type UIDeployment } from '@pritzlaff/nano-platform'

type Instance = ReturnType<typeof Platform.create>
const PLATFORM = Coord.namespace('workspace.host').implementationId('platform')
/** The `platform` pod's data: built on its first call. */
export const platformPod: Pod = { implementation: PLATFORM.toString(), eager: false }

/** "Add page p; remove page q; page r: add slot s, remove slot t", or "No change". */
function summary(was: UIDeployment, next: UIDeployment): string {
  const gone = (a: object, b: object) => Object.keys(a).filter(k => !(k in b))
  const slots = Object.keys(next.pages).filter(p => p in was.pages).flatMap(p => {
    const a = next.pages[p]!.slots, b = was.pages[p]!.slots
    const parts = [...gone(a, b).map(s => `add slot ${s}`), ...gone(b, a).map(s => `remove slot ${s}`)]
    return parts.length ? [`page ${p}: ${parts.join(', ')}`] : []
  })
  return [...gone(next.pages, was.pages).map(p => `Add page ${p}`), ...gone(was.pages, next.pages).map(p => `Remove page ${p}`), ...slots].join('; ') || 'Change the pages'
}

export function hostPlatform(platform: () => Instance | undefined, approve: (text: string) => Promise<boolean>) {
  const none = failure('not-found', 'this app keeps no pages')
  return Implementation.define(PLATFORM, {
    provides: [HostPlatform],
    make: () => [provide(HostPlatform, {
      document: async () => { const p = platform(); return p ? success(JSON.parse(JSON.stringify(p.document()))) : none },
      apply: async ({ next, base }): Promise<NanoResult<null>> => {
        const p = platform()
        if (!p) return none
        const at = p.document()
        if (base !== at.version) return failure('invalid-input', 'the pages changed since')
        const read = Platform.parse(next)
        if (!read.ok) return read
        const text = summary(at.doc, read.value)
        if (!await approve(text).catch(() => false)) return failure('denied', `not approved: ${text}`)
        const r = p.apply(read.value, { base })
        return r.ok ? success(null) : r
      },
    })],
  })
}
