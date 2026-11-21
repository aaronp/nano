/**
 * The workspace's pages at boot, on the host core. `oldForms` is its `migrate` hook (the host core calls it once, for
 * a document read from the old keys, with the registry): with no stored pages, the old ones (the document's
 * `layout.pages` or legacy Main, each with its old dock's keys, else the old saved pages) as the Outline, each old
 * dock's pod placed lazy in `main` under its name (its implementation found by the panel's widget id; none: dropped,
 * and a status says so); and the old `layout` read as `host.layout` (`hostLayout`). A pure data edit but for that status.
 * `settled` is the workspace's rule after any boot: Main there and the first root, the pages a tree (`treed`).
 *
 *   Host.boot(storage, { migrate: oldForms, ... });  outline.apply(settled(outline.document().doc))
 */
import { type AppDeployment, type Pod, type Registry } from '@pritzlaff/nano-core'
import { Outline } from '@pritzlaff/nano-outline'
import type { HostDocument } from '@pritzlaff/nano-host'
import { hostLayout, legacyPages, oldPages, toOutline, treed, withOldDocks, type Legacy } from './migrate.ts'
import { connected, showStatus } from './lib/status.ts'
import { MAIN } from './lib/pages.ts'

/** The widget id of the old panel showing `pod`, anywhere in `v` (a page's engine state). */
const widgetOf = (v: unknown, pod: string): string | undefined => {
  if (typeof v !== 'object' || v === null) return undefined
  const o = v as Record<string, unknown>
  if (o['name'] === pod && typeof o['widget'] === 'string') return o['widget']
  for (const x of Object.values(o)) { const w = widgetOf(x, pod); if (w) return w }
  return undefined
}
/** An implementation's palette widget id (as dock/panels.ts names its template). */
const widgetId = (coord: string) => coord.toLowerCase().replace(/[^a-z0-9]+/g, '-')

/** `d` with the old pages' pods it lacks placed lazy in `main` when their widget names an implementation. Pure. */
function placeOld(d: AppDeployment, registry: Registry, old: Legacy[]): AppDeployment {
  const impl = new Map(registry.manifest().implementations.map(i => [widgetId(i.coord), i.coord]))
  const add: Record<string, Pod> = {}
  for (const s of old.flatMap(p => p.slots)) if ('pod' in s && !d.pods[s.pod]) { const c = impl.get(widgetOf(old, s.pod) ?? ''); if (c) add[s.pod] = { implementation: c, eager: false } }
  const names = Object.keys(add), main = d.runtimes['main'] ?? { pods: [], subscriptions: [] }
  return names.length ? connected({ ...d, pods: { ...d.pods, ...add }, runtimes: { ...d.runtimes, main: { ...main, pods: [...main.pods, ...names] } } }, registry, names) : d
}

/** The host core's `migrate` hook: the workspace's old forms read into `doc`. */
export function oldForms(doc: HostDocument, storage: Storage, registry: Registry): HostDocument {
  let { app, outline } = doc
  const { layout, ...host } = doc.host ?? {}, l = hostLayout(layout)
  if (!Object.keys(outline.pages).length) {
    const kept = legacyPages(layout, app), old = kept.length ? withOldDocks(storage, kept) : oldPages(storage)
    app = placeOld(app, registry, old)
    outline = toOutline(old, app)
    const count = (n: number[]) => n.reduce((a, b) => a + b, 0)
    if (count(Object.values(outline.pages).map(p => Object.keys(p.slots).length)) < count(old.map(p => p.slots.length)))
      showStatus(document, 'Some panels of your old pages are gone: what they showed is no longer available.')
  }
  return { app, outline, ...((l || Object.keys(host).length) && { host: { ...host, ...(l && { layout: l }) } }) }
}

/** `doc` by the workspace's rule: Main there (recreated if missing) and the first root, a tree (`treed`), parsed. */
export function settled(doc: Outline): Outline {
  const pages = doc.pages[MAIN] ? doc : { roots: [MAIN, ...doc.roots], pages: { ...doc.pages, [MAIN]: { title: 'Workspace', slots: {} } } }
  const r = Outline.parse(JSON.parse(JSON.stringify(treed(pages))))
  return r.ok ? r.value : doc
}
