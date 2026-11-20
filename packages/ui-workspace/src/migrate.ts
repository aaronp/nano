/**
 * Migration into the UIDeployment (ADR-0038), in one place: the keys from before pages were deployment data (the saved
 * pages' list and each page's dock), a document's `layout.pages`, and the legacy `layout.workspace` (Main's dock) with
 * top-level `slots`/`geometry`. Each is first read as the old page list (`Legacy`, nano-ui's `pagesOf` form, copied here
 * as that goes), then `toPlatform` makes the UIDeployment: a pod slot a `pod` slot whose implementation is the
 * deployment's (none there: dropped), a view slot a `view` slot, title, icon, order and Save layout's restore point in
 * `meta`, the rest of the dock's state its `layout`. `geometry` is dropped (the arrangement is the dock's).
 *
 *   toPlatform(legacyPages(doc.layout, doc), doc)   // a stored document's pages
 *   opened(file)                                     // a nano.json or a { app, platform } bundle: the app, its pages
 */
import { Coord, failure, success, type AppDeployment, type NanoResult } from '@pritzlaff/nano-core'
import { Platform, type Page, type Slot, type UIDeployment } from '@pritzlaff/nano-platform'
import { panelsInOrder, type PanelState, type TemplateState } from './lib/layout-templates.ts'
import { MAIN } from './lib/pages.ts'

type OldSlot = { id: string; runtime: string; pod: string } | { id: string; view: string }
export type Legacy = { id: string; title: string; icon?: string; slots: OldSlot[]; workspace?: unknown; [k: string]: unknown }

const RESTORE = ['saved', 'saved.template']
// The keys before pages were deployment data: the saved pages' list and Main's title and icon (saved-workspaces), and
// Main's dock (index.html's `storage-key`), each saved page's dock under `<dock>.saved.<path>`, each with `.template`.
const LIST = 'workspace-starter.saved-workspaces', DOCK = 'workspace-starter.layout'
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'
const idOk = (id: unknown) => { try { return str(id) && !!Coord.runtime(id) } catch { return false } }
const slotOk = (s: unknown) => obj(s) && str(s.id) && (str(s.view) || (str(s.runtime) && str(s.pod)))
const pageOk = (p: unknown): p is Legacy => obj(p) && idOk(p.id) && str(p.title) && Array.isArray(p.slots) && p.slots.every(slotOk) && (p.icon === undefined || str(p.icon))
const panelsOf = (w: Record<string, unknown>) => {
  const t = w.template as TemplateState | undefined
  return obj(t) ? [...(t.order ?? []).filter((p): p is PanelState => !!p), ...(t.parked ?? [])] : panelsInOrder(w.root)
}

/** A legacy dock's panels as the old slots (as the old docks read them): a placed pod's panel a pod slot, any other a view slot of its widget; one per id. */
const slotsOf = (panels: PanelState[], runtimeOf: (pod: string) => string | undefined): OldSlot[] => {
  const slots = new Map<string, OldSlot>()
  for (const p of panels) {
    const runtime = p.name === undefined ? undefined : runtimeOf(p.name)
    if (runtime) slots.set(p.name!, { id: p.name!, runtime, pod: p.name! })
    else if (p.widget !== 'pod' && !slots.has(p.widget)) slots.set(p.widget, { id: p.widget, view: p.widget })
  }
  return [...slots.values()]
}

/** The old pages of a layout: its `pages` (bad ones dropped), else the legacy Main (`workspace`'s panels, else `slots`), else none. */
export function legacyPages(layout: unknown, d: AppDeployment): Legacy[] {
  if (!obj(layout)) return []
  if (Array.isArray(layout.pages)) return layout.pages.filter(pageOk)
  const { slots, workspace } = layout
  if (slots === undefined && workspace === undefined) return []
  const runtimeOf = (pod: string) => Object.entries(d.runtimes ?? {}).find(([, r]) => r.pods.includes(pod))?.[0]
  const page = { id: MAIN, title: 'Workspace', slots: obj(workspace) ? slotsOf(panelsOf(workspace), runtimeOf) : slots, ...(obj(workspace) && { workspace }) }
  return pageOk(page) ? [page] : []
}

/** `pages` as a UIDeployment, in their order; a pod slot whose pod `d` does not have is dropped. Pure. */
export function toPlatform(pages: Legacy[], d: AppDeployment): UIDeployment {
  const slot = (s: OldSlot): [string, Slot][] => {
    if ('view' in s) return [[s.id, { kind: 'view', view: s.view }]]
    const impl = d.pods[s.pod]?.implementation
    return impl ? [[s.id, { kind: 'pod', pod: Coord.pod(Coord.parse('implementation', impl), Coord.runtime(s.runtime), s.pod) }]] : []
  }
  const page = (p: Legacy, order: number): Page => {
    const w = obj(p.workspace) ? p.workspace : {}, layout = Object.fromEntries(Object.entries(w).filter(([k]) => !RESTORE.includes(k)))
    const restore = Object.fromEntries(Object.entries(w).filter(([k]) => RESTORE.includes(k)))
    return { slots: Object.fromEntries(p.slots.flatMap(slot)), ...(Object.keys(layout).length && { layout }), meta: { title: p.title, ...(p.icon !== undefined && { icon: p.icon }), order, ...restore } }
  }
  return { pages: Object.fromEntries(pages.map((p, i) => [p.id, page(p, i)])) }
}

/** `d` without the old pages in its layout (`pages`, `workspace`, `slots`, `geometry`); no layout once nothing is left. */
const stripped = (d: AppDeployment): AppDeployment => {
  if (!obj(d.layout)) return d
  const { pages: _p, workspace: _w, slots: _s, geometry: _g, ...rest } = d.layout, { layout: _, ...out } = d
  return Object.keys(rest).length ? { ...out, layout: rest } : out
}

/** A file as opened: a `{ app, platform }` bundle (File › Save's) as its two parts, a plain nano.json as itself with its old pages migrated. */
export function opened(file: unknown): NanoResult<{ app: AppDeployment; pages: UIDeployment }> {
  if (obj(file) && obj(file.app) && 'platform' in file) {
    const pages = Platform.parse(file.platform)
    return pages.ok ? success({ app: stripped(file.app as AppDeployment), pages: pages.value }) : failure('invalid-input', `the file's pages: ${pages.fail.reason}`)
  }
  if (!obj(file)) return failure('invalid-input', 'not a nano.json: not an object')
  const d = file as AppDeployment
  return success({ app: stripped(d), pages: obj(d.pods) ? toPlatform(legacyPages(d.layout, d), d) : { pages: {} } })
}

const read = (from: Storage, k: string): unknown => { try { return JSON.parse(from.getItem(k) ?? 'null') } catch { return null } }
const style = (from: Storage, dock: string) => { try { return from.getItem(`${dock}.window-style`) } catch { return null } }
/** A dock's old state (layout, template, window style) as a page's `workspace`, if it had any. */
const dockState = (from: Storage, dock: string) => {
  const config = read(from, dock), template = read(from, `${dock}.template`), s = style(from, dock)
  return obj(config) || obj(template) || s ? { ...(obj(config) && config), ...(obj(template) && { template }), ...(s && { 'window-style': s }) } : undefined
}

/** `pages` (a stored document's, from before docks kept their page), each with its old dock's state as its `workspace`. */
export function withOldDocks(from: Storage, pages: Legacy[]): Legacy[] {
  return pages.map(p => { const w = dockState(from, p.id === MAIN ? DOCK : `${DOCK}.saved./${p.id}`); return w ? { ...p, workspace: w } : p })
}

/** The old saved pages, Main first ([] when there were none). A pod panel is a pod slot (the old docks made their pods in `main`). */
export function oldPages(from: Storage): Legacy[] {
  const slotOf = (p: PanelState): OldSlot => p.name ? { id: p.name, runtime: 'main', pod: p.name } : { id: p.widget, view: p.widget }
  const page = (id: string, title: string, icon: unknown, dock: string): Legacy => {
    const workspace = dockState(from, dock), config = read(from, dock), template = read(from, `${dock}.template`), t = obj(template) ? template : {}
    const panels = [...panelsInOrder(obj(config) ? config.root : null), ...(Array.isArray(t.order) ? t.order : []).filter(obj),
      ...(Array.isArray(t.parked) ? t.parked : []), ...panelsInOrder(obj(t.dock) ? t.dock.root : null)] as PanelState[]
    const slots = [...new Map(panels.filter(p => obj(p) && str(p.widget)).map(p => [slotOf(p).id, slotOf(p)])).values()]
    return { id, title, ...(str(icon) && { icon }), ...(workspace && { workspace }), slots }
  }
  const list = read(from, LIST), main = read(from, `${LIST}.main`), saved = Array.isArray(list) ? list.filter(w => obj(w) && str(w.path)) : []
  const first = page(MAIN, obj(main) && str(main.title) ? main.title : 'Workspace', obj(main) ? main.icon : undefined, DOCK)
  const rest = saved.map(w => page(String(w.path).slice(1).replaceAll('/', '-'), String(w.title ?? w.path), w.icon, `${DOCK}.saved.${w.path}`))
  return first.workspace || rest.length || obj(main) ? [first, ...rest] : []
}

/** Removes every old key (once the UIDeployment holds what they held). Never throws. */
export function forgetOld(from: Storage): void {
  const old = (k: string | null) => !!k && [LIST, DOCK].some(o => k === o || k.startsWith(`${o}.`))
  try { for (let i = from.length - 1; i >= 0; i--) if (old(from.key(i))) from.removeItem(from.key(i)!) } catch { /* kept */ }
}
