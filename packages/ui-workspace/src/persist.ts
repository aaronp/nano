/**
 * The host's stored documents, each under its own key: the app's (`saved()`, ADR-0034) and its pages (the Outline,
 * written), loaded at boot and saved as they change; the pages read from `oldKey` (`nano-workspace.platform`) while
 * their own key is absent. Storage that throws or is full never throws here: the app runs in memory, and the first
 * failed save says so once. The first save that works removes `oldKey` and the keys from before pages were deployment
 * data (migrate.ts), so migration happens once.
 *
 *   const stored = persisted(localStorage, KEY, PAGES_KEY, OLD_PAGES_KEY)
 *   stored.load()            // the stored AppDeployment, or null
 *   stored.pages()           // the stored pages as written (Outline.parse reads them), or null
 *   stored.save(d, pages)    // both; and, the first time it works, the old keys go
 */
import type { AppDeployment } from '@pritzlaff/nano-core'
import type { Outline } from '@pritzlaff/nano-outline'
import { forgetOld } from './migrate.ts'
import { showStatus } from './lib/status.ts'

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function persisted(storage: Storage, key: string, pagesKey: string, oldKey?: string) {
  let told = false, cleared = false
  const read = (k: string): unknown => { try { return JSON.parse(storage.getItem(k) ?? 'null') } catch { return null } }
  return {
    load(): AppDeployment | null { const d = read(key); return obj(d) && obj(d.pods) && obj(d.runtimes) ? d as AppDeployment : null },
    pages(): unknown { let absent = false; try { absent = storage.getItem(pagesKey) === null } catch { /* unreadable */ } return read(absent && oldKey !== undefined ? oldKey : pagesKey) },
    save(d: AppDeployment, pages: Outline): void {
      try { storage.setItem(key, JSON.stringify(d)); storage.setItem(pagesKey, JSON.stringify(pages)) } catch (e) {
        if (!told) showStatus(document, `Your workspace is not being saved (${(e as Error).message}); it runs in memory until this page closes.`)
        told = true
        return
      }
      if (!cleared) { cleared = true; forgetOld(storage); try { if (oldKey !== undefined) storage.removeItem(oldKey) } catch { /* kept */ } }   // the pages hold what they held
    },
  }
}
