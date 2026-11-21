/**
 * The host document: the system (core's `AppDeployment`, with where its code comes from), its pages (the Outline) and
 * the host's presentation (`host.views`: pod → view tag; `host.layout`: keyed by client), stored as one JSON under one
 * key. A failed save is returned, never thrown. The old keys (migrate.ts) are read, never written or removed, until plan 5.
 */
import type { AppDeployment } from '@pritzlaff/nano-core'
import type { Outline } from '@pritzlaff/nano-outline'

export type HostDocument = { app: AppDeployment; outline: Outline; host?: { views?: Record<string, string>; layout?: Record<string, unknown> } }

export const KEY = 'nano-host.document'
/** The workspace's keys before the one key (migrate.ts reads them). */
export const OLD = ['nano-workspace.document', 'nano-workspace.outline', 'nano-workspace.platform'] as const

/** Saves `doc` under the one key; why not, if storage refused. */
export function write(s: Storage, doc: HostDocument): string | undefined {
  // ponytail: old keys kept until plan 5 moves the workspace to KEY
  try { s.setItem(KEY, JSON.stringify(doc)) } catch (e) { return e instanceof Error ? e.message : String(e) }
  return undefined
}
