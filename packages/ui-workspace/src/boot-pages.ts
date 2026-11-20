/**
 * The workspace's pages at boot. `bootPages` gives the Outline to start with: the stored one, made a tree with Main the
 * first root (`treed`: each page from before ADR-0039 keyed, the old order the roots'; boot-host.ts saves it); else, once, migrated (migrate.ts)
 * from the stored document's layout (each page with its old dock's keys), else the old keys, else Main alone. The old
 * docks made their pods as they mounted, so a migrated pod slot's pod is placed now, lazy in `main` under its name
 * (its implementation found by the panel's widget id); one with no implementation, or a page or slot with a bad id or
 * coordinate, is dropped, and a status says so.
 *
 *   const doc = await bootPages(host, localStorage, storedDoc, stored.pages())
 */
import { success, type AppDeployment, type NanoResult, type Pod } from '@pritzlaff/nano-core'
import { Outline } from '@pritzlaff/nano-outline'
import type { Host } from './host.ts'
import { implementationTemplates } from './dock/panels.ts'
import { connected } from './auto-connect.ts'
import { legacyPages, oldPages, toOutline, treed, withOldDocks, type Legacy } from './migrate.ts'
import { showStatus } from './lib/status.ts'

import { MAIN } from './lib/pages.ts'
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
}

/** The pages to boot with; `loaded`: whether the stored document loaded (if not, nothing is migrated, and nothing placed). */
export async function bootPages(host: Host, storage: Storage, doc: AppDeployment | null, stored: unknown, loaded = true): Promise<NanoResult<Outline>> {
  const read = stored !== null ? Outline.parse(stored) : success<Outline>({ roots: [], pages: {} })
  if (!read.ok) return read
  let pages = read.value
  if (stored === null && loaded) {
    const kept = legacyPages(doc?.layout, host.data()), old = kept.length ? withOldDocks(storage, kept) : oldPages(storage)
    await placeOld(host, old)
    pages = toOutline(old, host.data())
    const count = (n: number[]) => n.reduce((a, b) => a + b, 0)
    if (count(Object.values(pages.pages).map(p => Object.keys(p.slots).length)) < count(old.map(p => p.slots.length)))
      showStatus(document, 'Some panels of your old pages are gone: what they showed is no longer available.')
  }
  // a document saved without Main still has it; one with Main elsewhere than the first root has it moved there (treed)
  if (!pages.pages[MAIN]) pages = { roots: [MAIN, ...pages.roots], pages: { ...pages.pages, [MAIN]: { title: 'Workspace', slots: {} } } }
  return Outline.parse(JSON.parse(JSON.stringify(treed(pages))))   // what the Outline takes, or a failure (never a throw at boot)
}
