/**
 * The two documents, under the workspace's storage keys (so a page made in either host shows in the other): the app
 * document (an `AppDeployment` with its modules, views and layout) and the Platform's UIDeployment, as written.
 * Storage that throws reads as empty; a failed save is returned, not thrown.
 */
import type { AppDeployment } from '@pritzlaff/nano-core'
import type { UIDeployment } from '@pritzlaff/nano-platform'

export const KEYS = { app: 'nano-workspace.document', pages: 'nano-workspace.platform' } as const

const read = (s: Storage, k: string): unknown => { try { return JSON.parse(s.getItem(k) ?? 'null') } catch { return null } }
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The stored app document (null unless it has pods and runtimes) and pages (as written, or null). */
export function readStored(s: Storage): { app: AppDeployment | null; pages: unknown } {
  const app = read(s, KEYS.app)
  return { app: obj(app) && obj(app['pods']) && obj(app['runtimes']) ? app as AppDeployment : null, pages: read(s, KEYS.pages) }
}

/** Saves both; why not, if storage refused. */
export function writeStored(s: Storage, app: AppDeployment, pages: UIDeployment): string | undefined {
  try { s.setItem(KEYS.app, JSON.stringify(app)); s.setItem(KEYS.pages, JSON.stringify(pages)) } catch (e) { return e instanceof Error ? e.message : String(e) }
  return undefined
}
