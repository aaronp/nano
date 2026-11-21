/**
 * The host document: the system (core's `AppDeployment`, with where its code comes from), its pages (the Outline) and
 * the host's presentation (`host.views`: pod → view tag; `host.layout`: keyed by client), stored as one JSON under one
 * key. A failed save is returned, never thrown. The old keys (migrate.ts) are read, never written, and removed after a good save made with the host's `migrate` hook (without one, a host that cannot migrate them keeps them).
 */
import type { AppDeployment } from '@pritzlaff/nano-core'
import type { Outline } from '@pritzlaff/nano-outline'

export type HostDocument = { app: AppDeployment; outline: Outline; host?: { views?: Record<string, string>; layout?: Record<string, unknown> } }

export const KEY = 'nano-host.document'
/** The workspace's keys before the one key (migrate.ts reads them). */
export const OLD = ['nano-workspace.document', 'nano-workspace.outline', 'nano-workspace.platform'] as const

/** Saves `doc` under the one key, then, when `clear`, removes the old keys present (a removal fires `storage` in other tabs); why not, if storage refused. */
export function write(s: Storage, doc: HostDocument, clear = true): string | undefined {
  try { s.setItem(KEY, JSON.stringify(doc)) } catch (e) { return e instanceof Error ? e.message : String(e) }
  if (!clear) return undefined
  try { for (const k of OLD) if (s.getItem(k) !== null) s.removeItem(k) } catch { /* kept: read again only while the one key is absent */ }
  return undefined
}
