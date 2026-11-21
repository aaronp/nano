/**
 * The two documents, under the workspace's storage keys (so a page made in either host shows in the other): the app
 * document (an `AppDeployment` with its modules, views and layout) and the Outline (its pages), as written.
 * Storage that throws reads as empty; a failed save is returned, not thrown.
 */
import type { AppDeployment } from '@pritzlaff/nano-core'
import type { Outline } from '@pritzlaff/nano-outline'

export const KEYS = { app: 'nano-workspace.document', pages: 'nano-workspace.outline', old: 'nano-workspace.platform' } as const

const read = (s: Storage, k: string): unknown => { try { return JSON.parse(s.getItem(k) ?? 'null') } catch { return null } }
const absent = (s: Storage, k: string) => { try { return s.getItem(k) === null } catch { return false } }
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The stored app document (null unless it has pods and runtimes) and pages (as written, or null: the Outline's key, else, while that is absent (not when unreadable), the old `nano-workspace.platform`; only the Outline's is written). */
export function readStored(s: Storage): { app: AppDeployment | null; pages: unknown } {
  const app = read(s, KEYS.app)
  return { app: obj(app) && obj(app['pods']) && obj(app['runtimes']) ? app as AppDeployment : null, pages: read(s, absent(s, KEYS.pages) ? KEYS.old : KEYS.pages) }
}

/** Saves both; why not, if storage refused. */
export function writeStored(s: Storage, app: AppDeployment, pages: Outline): string | undefined {
  try { s.setItem(KEYS.app, JSON.stringify(app)); s.setItem(KEYS.pages, JSON.stringify(pages)) } catch (e) { return e instanceof Error ? e.message : String(e) }
  return undefined
}
