/**
 * The host's stored document (`saved()` with `layout.pages`), under one storage key: loaded at boot as the app's own
 * (ADR-0034), saved as it changes. Storage that throws or is full never throws here: the app runs in memory, and the
 * first failed save says so once. `migrate` reads the keys from before pages were deployment data into pages; given
 * pages (a stored document's, from before docks kept their page), it moves each page's old dock keys (layout, template,
 * window style) into its `workspace`. The first save that works removes every old key, so it all happens once.
 *
 *   const doc = persisted(localStorage, KEY)
 *   doc.load()                        // the stored AppDeployment, or null
 *   doc.save(d)                       // and, the first time it works, the old keys go
 *   doc.migrate(localStorage)         // the old saved pages, Main first ([] when there were none)
 *   doc.migrate(localStorage, pages)  // `pages`, each with its old dock's state as its `workspace`
 */
import type { AppDeployment } from '@pritzlaff/nano-core'
import type { Page } from '@pritzlaff/nano-ui'
import { panelsInOrder, type PanelState } from './lib/layout-templates.ts'
import { showStatus } from './lib/status.ts'

// The keys before pages were deployment data: the saved pages' list and Main's title and icon (saved-workspaces), and
// Main's dock (index.html's `storage-key`), each saved page's dock under `<dock>.saved.<path>`, each with `.template`.
const LIST = 'workspace-starter.saved-workspaces', DOCK = 'workspace-starter.layout'
const old = (k: string | null) => !!k && [LIST, DOCK].some(o => k === o || k.startsWith(`${o}.`))
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A pod panel is a pod slot (the old docks made their pods in `main`); any other panel a view slot of its widget. */
const slotOf = (p: PanelState): Page['slots'][number] => p.name ? { id: p.name, runtime: 'main', pod: p.name } : { id: p.widget, view: p.widget }

export function persisted(storage: Storage, key: string) {
  let told = false, cleared = false
  return {
    load(): AppDeployment | null {
      try { const d = JSON.parse(storage.getItem(key) ?? 'null'); return obj(d) && obj(d.pods) && obj(d.runtimes) ? d as AppDeployment : null } catch { return null }
    },
    save(d: AppDeployment): void {
      try { storage.setItem(key, JSON.stringify(d)) } catch (e) {
        if (!told) showStatus(document, `Your workspace is not being saved (${(e as Error).message}); it runs in memory until this page closes.`)
        told = true
        return
      }
      if (cleared) return
      cleared = true   // the document holds what they held
      try { for (let i = storage.length - 1; i >= 0; i--) if (old(storage.key(i))) storage.removeItem(storage.key(i)!) } catch { /* kept */ }
    },
    migrate(from: Storage, pages?: Page[]): Page[] {
      const read = (k: string): unknown => { try { return JSON.parse(from.getItem(k) ?? 'null') } catch { return null } }
      const style = (dock: string) => { try { return from.getItem(`${dock}.window-style`) } catch { return null } }
      if (pages) return pages.map(p => {
        const dock = p.id === 'workspace' ? DOCK : `${DOCK}.saved./${p.id}`, config = read(dock), template = read(`${dock}.template`), s = style(dock)
        return obj(config) || obj(template) || s ? { ...p, workspace: { ...(obj(config) && config), ...(obj(template) && { template }), ...(s && { 'window-style': s }) } } : p
      })
      const page = (id: string, title: string, icon: unknown, dock: string): Page => {
        const config = read(dock), template = read(`${dock}.template`), s = style(dock)
        const t = obj(template) ? template : {}, panels = [...panelsInOrder(obj(config) ? config.root : null),
          ...(Array.isArray(t.order) ? t.order : []).filter(obj), ...(Array.isArray(t.parked) ? t.parked : []), ...panelsInOrder(obj(t.dock) ? t.dock.root : null)] as PanelState[]
        const slots = [...new Map(panels.filter(p => obj(p) && typeof p.widget === 'string').map(p => [slotOf(p).id, slotOf(p)])).values()]
        const workspace = obj(config) || obj(template) || s ? { ...(obj(config) && config), ...(obj(template) && { template }), ...(s && { 'window-style': s }) } : undefined
        return { id, title, ...(typeof icon === 'string' && { icon }), ...(workspace && { workspace }), slots }
      }
      const list = read(LIST), main = read(`${LIST}.main`), saved = Array.isArray(list) ? list.filter(w => obj(w) && typeof w.path === 'string') : []
      const first = page('workspace', obj(main) && typeof main.title === 'string' ? main.title : 'Workspace', obj(main) ? main.icon : undefined, DOCK)
      const rest = saved.map(w => page(String(w.path).slice(1).replaceAll('/', '-'), String(w.title ?? w.path), w.icon, `${DOCK}.saved.${w.path}`))
      return first.workspace || rest.length || obj(main) ? [first, ...rest] : []
    },
  }
}
