// A flat write in a test: every page a root, in key order (what `Outline.parse` makes of a flat `{ pages }`); and
// `liveOutline`, the host core's live outline (what `host.outline` is) over a test's own app, its document read as Host.boot reads it.
import type { Application, Registry } from '@pritzlaff/nano-core'
import { Outline, type Page } from '@pritzlaff/nano-outline'
import { live } from '../../host/src/outline-live.ts'

export const flat = (pages: Record<string, Page>): Outline => ({ roots: Object.keys(pages), pages })

export const liveOutline = (app: Application, registry: Registry, doc: Outline = { roots: [], pages: {} }) => {
  const r = Outline.parse(JSON.parse(JSON.stringify(doc)))
  if (!r.ok) throw new Error(r.fail.reason)
  return live(app, registry, r.value)
}
