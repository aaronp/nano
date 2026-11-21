/**
 * Reading the host document (spec §6): the one key, else the old forms (the workspace's `nano-workspace.document` and
 * `nano-workspace.outline`, else `nano-workspace.platform`, a flat outline read as every page a root), then the host's
 * own hook for its own old forms. `views` and `layout` inside an app document move to `host`. Storage that throws reads
 * as empty; a document that is there but unreadable is a failure, so it is never saved over.
 * Legacy: the old forms go the release after this one (spec §6).
 */
import { failure, success, type AppDeployment, type NanoResult } from '@pritzlaff/nano-core'
import { Outline } from '@pritzlaff/nano-outline'
import { KEY, OLD, type HostDocument } from './document.ts'

export type Migrate = (doc: HostDocument, storage: Storage) => HostDocument

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (s: Storage, k: string) => { try { return s.getItem(k) } catch { return null } }
const json = (t: string | null, k: string): NanoResult<unknown> => {
  try { return success(t === null ? null : JSON.parse(t)) } catch (e) { return failure('invalid-input', `${k}: ${e instanceof Error ? e.message : String(e)}`) }
}

/** The parts read as a `HostDocument`: none an empty one, `views`/`layout` moved out of the app. */
function documentOf(app: unknown, outline: unknown, host: unknown): NanoResult<HostDocument> {
  const a = app ?? { pods: {}, runtimes: {} }
  if (!obj(a) || !obj(a['pods']) || !obj(a['runtimes'])) return failure('invalid-input', 'the stored app document has no pods and runtimes')
  if (host !== undefined && !obj(host)) return failure('invalid-input', 'the stored host part is not an object')
  const pages = outline === null || outline === undefined ? success<Outline>({ roots: [], pages: {} }) : Outline.parse(outline)
  if (!pages.ok) return failure('invalid-input', `the stored outline: ${pages.fail.reason}`)
  const { views, layout, ...rest } = a as AppDeployment, h = { ...host }
  if (views) h.views = { ...views, ...h.views as object }
  if (layout) h.layout = { ...layout, ...h.layout as object }
  return success({ app: rest, outline: pages.value, ...(Object.keys(h).length && { host: h as HostDocument['host'] }) })
}

/** The stored document: the one key, else the old forms through `migrate`. */
export function stored(s: Storage, migrate?: Migrate): NanoResult<HostDocument> {
  const now = json(text(s, KEY), KEY)
  if (!now.ok) return now
  if (now.value !== null) return obj(now.value) ? documentOf(now.value['app'], now.value['outline'], now.value['host']) : failure('invalid-input', `${KEY} is not a host document`)
  const [appKey, outlineKey, platformKey] = OLD, pagesKey = text(s, outlineKey) === null ? platformKey : outlineKey
  const app = json(text(s, appKey), appKey), pages = json(text(s, pagesKey), pagesKey)
  if (!app.ok) return app
  if (!pages.ok) return pages
  const doc = documentOf(app.value, pages.value, undefined)
  return doc.ok && migrate ? success(migrate(doc.value, s)) : doc
}
