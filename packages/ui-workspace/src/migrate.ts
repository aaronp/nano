/**
 * Migration into the Outline (ADR-0038, ADR-0040), in one place: the old keys (the saved pages' list, each page's
 * dock), a document's `layout.pages`, and the legacy `layout.workspace` with top-level `slots`/`geometry`, each read as
 * the old page list (`Legacy`), then `toOutline`: each page a root, a pod slot by the deployment's implementation (none:
 * dropped), the title its `title`, icon and Save layout's restore point in `meta.workspace`, the dock's state its
 * `layout.workspace` (ADR-0039). `keyed` moves a page from before ADR-0039 under the workspace's keys, `treed` a flat
 * document or one in the old `meta.workspace.order` into a tree; both once, and as they are when already done.
 *
 *   treed(toOutline(legacyPages(doc.layout, doc), doc))   // a stored document's pages
 *   opened(file)   // a nano.json, or an { app, outline } (before: { app, platform }) bundle: the app, its pages
 */
import { Coord, failure, success, type AppDeployment, type NanoResult } from '@pritzlaff/nano-core'
import { Outline, type Page, type Slot } from '@pritzlaff/nano-outline'
import { panelsInOrder, type PanelState, type TemplateState } from './lib/layout-templates.ts'
import { MAIN, metaOf, withMeta } from './lib/pages.ts'

type OldSlot = { id: string; runtime: string; pod: string } | { id: string; view: string }
export type Legacy = { id: string; title: string; icon?: string; slots: OldSlot[]; workspace?: unknown; [k: string]: unknown }

const RESTORE = ['saved', 'saved.template']
/** The workspace's keys at the top of a page's `layout` and `meta` before ADR-0039: golden-layout's config and those beside it; its meta. */
const ENGINE = ['root', 'openPopouts', 'dimensions', 'settings', 'header', 'resolved', 'template', 'window-style'], MINE = ['icon', 'order', ...RESTORE]
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

/** `o`'s entries split by whether their key is in `keys`. */
const split = (o: Record<string, unknown>, keys: string[]) => [false, true].map(b => Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k) === b))) as [Record<string, unknown>, Record<string, unknown>]

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

/** `pages` as an Outline, in their order; a pod slot whose pod `d` does not have, and a page or slot whose id or coordinate is bad, is dropped. Pure. */
export function toOutline(pages: Legacy[], d: AppDeployment): Outline {
  const slot = (s: OldSlot): [string, Slot][] => {
    if (!idOk(s.id)) return []
    if ('view' in s) return s.view ? [[s.id, { kind: 'view', view: s.view }]] : []
    const impl = d.pods[s.pod]?.implementation
    try { return impl ? [[s.id, { kind: 'pod', pod: Coord.pod(Coord.parse('implementation', impl), Coord.runtime(s.runtime), s.pod) }]] : [] } catch { return [] }
  }
  const page = (p: Legacy): Page => {
    const [layout, restore] = split(obj(p.workspace) ? p.workspace : {}, RESTORE), meta = { ...(p.icon !== undefined && { icon: p.icon }), ...restore }
    return { title: p.title, slots: Object.fromEntries(p.slots.flatMap(slot)), ...(Object.keys(layout).length && { layout: { workspace: layout } }), ...(Object.keys(meta).length && { meta: { workspace: meta } }) }
  }
  const kept = pages.filter(p => idOk(p.id))
  return { roots: [...new Set(kept.map(p => p.id))], pages: Object.fromEntries(kept.map(p => [p.id, page(p)])) }
}

/** Page `p` under the workspace's keys (ADR-0039): its dock's state to `layout.workspace`, `meta.title` to `title`, its
 * meta to `meta.workspace`; other keys kept where they are. A page with either `workspace` key, or nothing to move, as it is. */
export function keyed(p: Page): Page {
  const l = obj(p.layout) ? p.layout : {}, m = obj(p.meta) ? p.meta : {}
  if ('workspace' in l || 'workspace' in m) return p
  const [others, engine] = split(l, ENGINE), move = str(m['title']) && p.title === undefined, { title, ...rest } = m, [kept, mine] = split(move ? rest : m, MINE)
  const moves = (o: object) => Object.keys(o).length > 0
  if (!moves(engine) && !moves(mine) && !move) return p
  return { ...p, ...(move && { title: title as string }), ...(moves(engine) && { layout: { ...others, workspace: engine } }), ...((move || moves(mine)) && { meta: { ...kept, workspace: mine } }) }
}

/** `d` without the old pages in its layout (`pages`, `workspace`, `slots`, `geometry`); no layout once nothing is left. */
const stripped = (d: AppDeployment): AppDeployment => {
  if (!obj(d.layout)) return d
  const { pages: _p, workspace: _w, slots: _s, geometry: _g, ...rest } = d.layout, { layout: _, ...out } = d
  return Object.keys(rest).length ? { ...out, layout: rest } : out
}

/** `p` without the old `meta.workspace.order`. */
const unordered = (p: Page): Page => { if (!('order' in metaOf(p))) return p; const { order: _, ...w } = metaOf(p); return withMeta(p, w) }
/** `doc` a tree, once: each page `keyed`, the roots in the old order (Main first, moved there from wherever it is; a page without an order last), the order and empty `children` dropped. */
export function treed(doc: Outline): Outline {
  const pages = Object.fromEntries(Object.entries(doc.pages).map(([id, p]) => [id, keyed(p)]))
  const at = (id: string) => { const o = metaOf(pages[id])['order']; return id === MAIN ? -Infinity : typeof o === 'number' ? o : Infinity }
  const roots = [...(Object.hasOwn(pages, MAIN) ? [MAIN] : []), ...doc.roots.filter(r => r !== MAIN)].sort((a, b) => at(a) - at(b) || 0)
  const kids = (p: Page): Page => { const { children = [], ...rest } = p, c = children.filter(x => x !== MAIN); return c.length ? { ...rest, children: c } : rest }   // no Main, no empty list
  return { roots, pages: Object.fromEntries(Object.entries(pages).map(([id, p]) => [id, unordered(kids(p))])) }
}

/** A file as opened: an `{ app, outline }` bundle (File › Save's; `{ app, platform }` before) as its two parts, a plain nano.json as itself with its old pages migrated; its pages `treed`. */
export function opened(file: unknown): NanoResult<{ app: AppDeployment; pages: Outline }> {
  if (obj(file) && obj(file.app) && ('outline' in file || 'platform' in file)) {
    const pages = Outline.parse('outline' in file ? file.outline : file.platform)
    return pages.ok ? success({ app: stripped(file.app as AppDeployment), pages: treed(pages.value) }) : failure('invalid-input', `the file's pages: ${pages.fail.reason}`)
  }
  if (!obj(file)) return failure('invalid-input', 'not a nano.json: not an object')
  const d = file as AppDeployment
  return success({ app: stripped(d), pages: obj(d.pods) ? treed(toOutline(legacyPages(d.layout, d), d)) : { roots: [], pages: {} } })
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

/** Removes every old key (once the Outline holds what they held). Never throws. */
export function forgetOld(from: Storage): void {
  const old = (k: string | null) => !!k && [LIST, DOCK].some(o => k === o || k.startsWith(`${o}.`))
  try { for (let i = from.length - 1; i >= 0; i--) if (old(from.key(i))) from.removeItem(from.key(i)!) } catch { /* kept */ }
}
