/**
 * The workspace's pages at boot, and the page store kept in step with the Platform until the nav and docks read it
 * (lib/pages.ts). `bootPages` gives the UIDeployment to start with: the stored one; else, once, migrated (migrate.ts)
 * from the stored document's layout (each page with its old dock's keys), else the old keys, else Main alone. The old
 * docks made their pods as they mounted, so a migrated pod slot's pod is placed now, lazy in `main` under its name
 * (its implementation found by the panel's widget id); one with no implementation is dropped, and a status says so.
 * `mirror` copies the Platform's pages into the store (a slot that resolves to nothing left out; a selector shown as
 * the pod it found), and a write to the store into the Platform: the slots it could not show, and a selector's slot
 * that still shows its pod, kept.
 *
 *   const doc = await bootPages(host, localStorage, storedDoc, stored.pages())
 *   mirror(platform, pages)
 */
import { success, type AppDeployment, type NanoResult, type Pod } from '@pritzlaff/nano-core'
import { Platform, type UIDeployment } from '@pritzlaff/nano-platform'
import type { Page } from '@pritzlaff/nano-ui'
import type { Host } from './host.ts'
import type { pageStore } from './lib/pages.ts'
import { implementationTemplates } from './dock/panels.ts'
import { connected } from './auto-connect.ts'
import { legacyPages, oldPages, toPlatform, withOldDocks, type Legacy } from './migrate.ts'
import { showStatus } from './lib/status.ts'

const MAIN = 'workspace'
/** The widget id of the old panel showing `pod`, anywhere in `v` (a page's engine state). */
const widgetOf = (v: unknown, pod: string): string | undefined => {
  if (typeof v !== 'object' || v === null) return undefined
  const o = v as Record<string, unknown>
  if (o['name'] === pod && typeof o['widget'] === 'string') return o['widget']
  for (const x of Object.values(o)) { const w = widgetOf(x, pod); if (w) return w }
  return undefined
}

/** The old pages' pods not in the deployment, placed lazy in `main` when their widget names an implementation. */
async function placeOld(host: Host, old: Legacy[]): Promise<void> {
  const missing = old.flatMap(p => p.slots).flatMap(s => 'pod' in s && !host.data().pods[s.pod] ? [s.pod] : [])
  if (!missing.length) return
  const impl = new Map(implementationTemplates(host, document).map(t => [t.dataset['widget'], t.dataset['implementation']!]))
  const add: Record<string, Pod> = {}
  for (const pod of missing) { const c = impl.get(widgetOf(old, pod)); if (c) add[pod] = { implementation: c, eager: false } }
  const d = host.data(), main = d.runtimes['main']!, names = Object.keys(add)
  if (names.length) await host.apply(connected({ ...d, pods: { ...d.pods, ...add }, runtimes: { ...d.runtimes, main: { ...main, pods: [...main.pods, ...names] } } }, host.registry, names))
  if (names.length < missing.length) showStatus(document, 'Some panels of your old pages are gone: what they showed is no longer available.')
}

/** The pages to boot with; `loaded`: whether the stored document loaded (if not, nothing is migrated, and nothing placed). */
export async function bootPages(host: Host, storage: Storage, doc: AppDeployment | null, stored: unknown, loaded = true): Promise<NanoResult<UIDeployment>> {
  const read = stored !== null ? Platform.parse(stored) : success<UIDeployment>({ pages: {} })
  if (!read.ok) return read
  if (stored === null && loaded) {
    const kept = legacyPages(doc?.layout, host.data()), old = kept.length ? withOldDocks(storage, kept) : oldPages(storage)
    await placeOld(host, old)
    read.value.pages = toPlatform(old, host.data()).pages
  }
  read.value.pages[MAIN] ??= { slots: {}, meta: { title: 'Workspace', order: 0 } }   // a document saved without Main still has it
  return read
}

type Store = ReturnType<typeof pageStore>
type Instance = ReturnType<typeof Platform.create>
type Meta = { title?: string; icon?: string; order?: number; [k: string]: unknown }

/** The Platform's pages as the store holds them, in order; slots resolving to nothing left out. */
function asStore(platform: Instance): Page[] {
  const meta = (id: string) => (platform.document().doc.pages[id]!.meta ?? {}) as Meta
  const at = (id: string) => meta(id).order ?? Infinity
  return Object.keys(platform.document().doc.pages).sort((a, b) => (a === MAIN ? -1 : b === MAIN ? 1 : at(a) - at(b))).map(id => {
    const p = platform.document().doc.pages[id]!, { title, icon, saved, 'saved.template': template } = meta(id)
    const restore = { ...(saved !== undefined && { saved }), ...(template !== undefined && { 'saved.template': template }) }
    const slots = Object.entries(platform.resolve(id)).flatMap(([s, r]): Page['slots'] =>
      r.kind === 'view' ? [{ id: s, view: r.view }] : r.kind === 'pod' ? [{ id: s, runtime: r.pods[0]!.runtime.id, pod: r.pods[0]!.pod }] : [])
    const workspace = { ...(p.layout as object), ...restore }
    return { id, title: title ?? id, ...(icon !== undefined && { icon }), slots, ...(Object.keys(workspace).length && { workspace }) }
  })
}

export function mirror(platform: Instance, store: Store, data: () => AppDeployment): void {
  let busy = false, held = new Set<string>(), heard = 0, mine = 0
  const quiet = (f: () => void) => { busy = true; try { f() } finally { busy = false; held = new Set(store.list().map(p => p.id)) } }
  // Each write of its own tells the store's listeners once; a listener's write while it reseeds is one more, pushed after.
  const reseed = () => {
    heard = mine = 0
    quiet(() => {
      const want = asStore(platform), own = (r: { ok: boolean }) => { if (r.ok) mine++ }
      for (const p of store.list()) if (!want.some(w => w.id === p.id)) own(store.remove(p.id))
      want.forEach((p, i) => { if (JSON.stringify(store.get(p.id)) !== JSON.stringify(p) || store.list()[i]?.id !== p.id) own(store.set(p, i)) })
    })
    if (heard > mine) push()
  }
  const push = () => quiet(() => {
    const cur = platform.document().doc, next = toPlatform(store.list(), data())
    for (const [id, p] of Object.entries(next.pages)) {
      const was = cur.pages[id], r = platform.resolve(id)
      const { title: _t, icon: _i, order: _o, saved: _s, 'saved.template': _st, ...other } = (was?.meta ?? {}) as Meta
      p.meta = { ...other, ...(p.meta as object) }   // meta the store does not hold, kept
      for (const [s, v] of Object.entries(was?.slots ?? {}))
        if (!(s in p.slots) ? r[s]?.kind === 'missing' : v.kind === 'select' && p.slots[s]!.kind === 'pod') p.slots[s] = v
    }
    for (const [id, p] of Object.entries(cur.pages)) if (!held.has(id)) next.pages[id] ??= p   // the store never held it
    const done = platform.apply(next)
    if (!done.ok) showStatus(document, done.fail.reason)
  })
  reseed()
  platform.listen(() => { if (!busy) reseed() })
  store.subscribe(() => { if (busy) heard++; else push() })
}

