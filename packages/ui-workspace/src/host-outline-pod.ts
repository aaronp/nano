/**
 * `workspace.host/outline`: this host's HostOutline over its Outline (boot-host.ts), the pod `outline` beside `ui` and
 * `deploy` in `main`, never saved. `document` gives the pages, written, at their version, unasked. `apply({ next, base })`
 * is refused when `base` is stale ("the pages changed since"), `next` is malformed or breaks the workspace's rules
 * (`refusal`, lib/pages.ts: Main dropped or not the first root), else asks
 * `approve` (HostUI's through the app, timed by hostProvider) with a summary of the pages and slots added or removed
 * and the pages moved; anything but a yes is `denied`, a yes applies `next` at `base`. The workspace's own edits apply
 * unasked. A tool slot naming a widget (a legacy `view`'s) is applied as its tool's (`tooled`). Once built, the pod
 * publishes each change the Outline reports as `changed`: boot-host.ts builds it as the Outline is made (`getOrCreate`),
 * and again on each `restarted` (a restart does not rebuild a lazy pod); a build that closes stops publishing until it
 * is built again. Without an Outline (a replayed app's provider) both are not-found.
 *
 *   ns.provider([hostUi, deploy, hostOutline(() => outline, timed(askTheUser))])   // hostProvider (host-deploy.ts)
 *   { outline: outlinePod }   // placed first in `main` by host.ts
 */
import { Coord, Implementation, failure, provide, success, type NanoResult, type Pod } from '@pritzlaff/nano-core'
import { HostOutline, Outline } from '@pritzlaff/nano-outline'
import { parentOf, refusal, walk } from './lib/pages.ts'
import { tooled } from './lib/tools.ts'

type Instance = ReturnType<typeof Outline.create>
const OUTLINE = Coord.namespace('workspace.host').implementationId('outline')
/** The `outline` pod's data: built on its first call. */
export const outlinePod: Pod = { implementation: OUTLINE.toString(), eager: false }

/** The pages in both whose parent, or place among the siblings that kept theirs, changed: the Outline's `moved`, before the apply. */
function movedIn(was: Outline, next: Outline): string[] {
  const place = (d: Outline, id: string) => { const p = parentOf(d, id); return { p, list: p === undefined ? d.roots : d.pages[p]!.children ?? [] } }
  const kept = (list: string[]) => list.filter(x => Object.hasOwn(was.pages, x) && Object.hasOwn(next.pages, x) && parentOf(was, x) === parentOf(next, x))
  return walk(next).filter(id => {
    if (!Object.hasOwn(was.pages, id)) return false
    const a = place(was, id), b = place(next, id)
    return a.p !== b.p || kept(a.list).indexOf(id) !== kept(b.list).indexOf(id)
  })
}

/** "Add page p; remove page q; page r: add slot s, remove slot t; Move page m", or "Change the pages". */
function summary(was: Outline, next: Outline): string {
  const gone = (a: object, b: object) => Object.keys(a).filter(k => !(k in b))
  const slots = Object.keys(next.pages).filter(p => p in was.pages).flatMap(p => {
    const a = next.pages[p]!.slots, b = was.pages[p]!.slots
    const parts = [...gone(a, b).map(s => `add slot ${s}`), ...gone(b, a).map(s => `remove slot ${s}`)]
    return parts.length ? [`page ${p}: ${parts.join(', ')}`] : []
  })
  return [...gone(next.pages, was.pages).map(p => `Add page ${p}`), ...gone(was.pages, next.pages).map(p => `Remove page ${p}`), ...slots, ...movedIn(was, next).map(p => `Move page ${p}`)].join('; ') || 'Change the pages'
}

export function hostOutline(outline: () => Instance | undefined, approve: (text: string) => Promise<boolean>) {
  const none = failure('not-found', 'this app keeps no pages')
  return Implementation.define(OUTLINE, {
    provides: [HostOutline],
    make: ctx => {
      let following: Instance | undefined
      const follow = () => {   // the Outline may be made after this pod (boot-host.ts): followed from the first call that finds it
        const o = outline()
        if (!o || o === following) return o
        following = o
        const stop = o.listen(({ added, removed, changed, moved }) => {
          if (added.length || removed.length || changed.length || moved.length) void ctx.publish(HostOutline.ops.changed, { added, removed, changed, moved })
        })
        ctx.addOnCloseListener(stop)
        return o
      }
      follow()
      return [provide(HostOutline, {
        document: async () => { const p = follow(); return p ? success(JSON.parse(JSON.stringify(p.document()))) : none },
        apply: async ({ next, base }): Promise<NanoResult<null>> => {
          const p = follow()
          if (!p) return none
          const at = p.document()
          if (base !== at.version) return failure('invalid-input', 'the pages changed since')
          const read = Outline.parse(next)
          if (!read.ok) return read
          const doc = { ...read.value, pages: Object.fromEntries(Object.entries(read.value.pages).map(([id, page]) => [id, tooled(page)])) }   // a widget id (a legacy view's) as its tool's
          const why = refusal(doc)
          if (why) return failure('invalid-input', why)
          const text = summary(at.doc, doc)
          if (!await approve(text).catch(() => false)) return failure('denied', `not approved: ${text}`)
          const r = p.apply(doc, { base })
          return r.ok ? success(null) : r
        },
      })]
    },
  })
}
