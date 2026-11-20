/**
 * The layout convention: the app's pages, engine-neutral, inside `AppDeployment.layout` (the deployer's plain object).
 * Each page has an id (fixed when it is made), a title, an optional icon, its slots (a placed pod, or a view by its
 * custom-element tag), their geometry, and each layout engine's own state under the engine's key.
 *
 *   "layout": { "pages": [{
 *     "id": "workspace", "title": "Main",
 *     "slots": [{ "id": "a", "runtime": "example.todo.frontend", "pod": "listA" }, { "id": "x", "view": "nano-explorer" }],
 *     "geometry": { "a": { "x": 0, "y": 0, "w": 0.5, "h": 1 } },
 *     "workspace": { ...golden-layout's own state }
 *   }] }
 *
 * A file from before pages has `slots`, `geometry` and `workspace` at the top: `pagesOf` reads them as one page. A pod
 * has at most one view (its implementation's, from the provider module's `views`, or the deployment's `views`
 * override); a pod in no page's slots runs unseen.
 */
import { Coord } from '@pritzlaff/nano-core'

/** A placed pod. `id` is the slot's engine-neutral name. */
export type LayoutSlot = { id: string; runtime: string; pod: string }
/** Where a slot sits, as fractions (0..1) of the page. */
export type LayoutBox = { x: number; y: number; w: number; h: number }
/** A placed view: `view` is a custom-element tag, not a pod's. */
export type ViewSlot = { id: string; view: string }
type Slot = LayoutSlot | ViewSlot
/** A page of the layout; each engine keeps its own state under its own key. `id` follows core's runtime id rule. */
export type Page = { id: string; title: string; icon?: string; slots: Slot[]; geometry?: Record<string, LayoutBox>; [engine: string]: unknown }
/** The neutral part of `AppDeployment.layout`; `geometry` is keyed by slot id. */
export type LayoutData = { slots?: LayoutSlot[]; geometry?: Record<string, LayoutBox>; pages?: Page[] }

const str = (v: unknown): v is string => typeof v === 'string'
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
// Core's runtime id rule (`Coord.runtime`): slightly stricter than the deployment `Id` schema (it rejects `@`).
const idOk = (id: unknown) => { try { return str(id) && !!Coord.runtime(id) } catch { return false } }
const slotOk = (s: unknown) => obj(s) && str(s.id) && (str(s.view) || (str(s.runtime) && str(s.pod)))
const pageOk = (p: unknown): p is Page =>
  obj(p) && idOk(p.id) && str(p.title) && Array.isArray(p.slots) && p.slots.every(slotOk) && (p.icon === undefined || str(p.icon)) && (p.geometry === undefined || obj(p.geometry))

/** The layout's pages: `pages` with bad ones dropped (each warned), else the legacy `slots`/`geometry`/`workspace` as one page, else none. */
export function pagesOf(layout: unknown): Page[] {
  if (!obj(layout)) return []
  if (Array.isArray(layout.pages)) {
    return layout.pages.filter(p => pageOk(p) || (console.warn('nano-ui: dropping a bad page', p), false))
  }
  if (layout.slots === undefined && layout.geometry === undefined && layout.workspace === undefined) return []
  const { slots, geometry, workspace } = layout
  const legacy = { id: 'workspace', title: 'Workspace', slots: slots ?? [], ...(geometry !== undefined && { geometry }), ...(workspace !== undefined && { workspace }) }
  return pageOk(legacy) ? [legacy] : (console.warn('nano-ui: dropping a bad legacy layout'), [])
}
