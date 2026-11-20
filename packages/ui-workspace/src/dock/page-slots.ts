/**
 * A dock on its page (ADR-0032): the page's `slots` are the truth, the dock's engine state (its page's `workspace` key)
 * a hint under them. Pure over the data: `slotsOf` reads slots from a dock's panels; `reconcile` drops engine entries
 * that have no slot and returns the slots the engine lacks, to be split in.
 * `keepDocks(doc, store)` puts each page's dock (its route's id names the page) on its page: its `storage` is the page's
 * `workspace` key (written with `store.set`; read reconciled with the slots); once built, the slots it lacks are added;
 * on each `dock:layout` the page's slots are rewritten from its panels. A store change made elsewhere is reconciled into
 * a built dock: missing slots added; any panel to drop, and the dock is built again from its page. Its own writes are
 * not reconciled again.
 *
 *   slotsOf([{ widget: 'pod', name: 'clock1' }, { widget: 'notes' }], runtimeOf)   // [{ id: 'clock1', runtime: 'main', pod: 'clock1' }, { id: 'notes', view: 'notes' }]
 *   const { engine, add } = reconcile(page.workspace, page.slots)
 *   keepDocks(document, pages)
 */
import type { LayoutSlot, ViewSlot } from '@pritzlaff/nano-ui';
import type { WorkspaceDock } from '../components/workspace-dock.ts';
import { requestBus } from '../lib/bus.ts';
import { panelsInOrder, type PanelState, type TemplateState } from '../lib/layout-templates.ts';
import type { pageStore } from '../lib/pages.ts';

type Slot = LayoutSlot | ViewSlot;
type Item = { type?: string; content?: Item[]; activeItemIndex?: number; componentState?: unknown };
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A placed pod's panel gives a pod slot; a `pod` panel whose pod is gone none; any other panel a view slot of its widget. One slot per id. */
export function slotsOf(panels: PanelState[], runtimeOf: (pod: string) => string | undefined): Slot[] {
  const slots = new Map<string, Slot>();
  for (const p of panels) {
    const runtime = p.name === undefined ? undefined : runtimeOf(p.name);
    if (runtime) slots.set(p.name!, { id: p.name!, runtime, pod: p.name! });
    else if (p.widget !== 'pod' && !slots.has(p.widget)) slots.set(p.widget, { id: p.widget, view: p.widget });
  }
  return [...slots.values()];
}

/** Whether a panel shows one of `slots`: a pod slot's pod, or a view slot's widget. */
const shown = (p: PanelState, slots: Slot[]) => slots.some((s) => ('pod' in s ? s.pod === p.name : s.view === p.widget));

/** golden-layout's tree without the panels that have no slot, and without the containers that left empty. */
function prune(item: Item | undefined, slots: Slot[]): Item | undefined {
  if (!obj(item)) return undefined;
  if (item.type === 'component') return shown(item.componentState as PanelState, slots) ? item : undefined;
  const content = (item.content ?? []).map((i) => prune(i, slots)).filter((i): i is Item => !!i);
  if (!content.length) return undefined;
  return { ...item, content, ...(item.activeItemIndex !== undefined && { activeItemIndex: Math.min(item.activeItemIndex, content.length - 1) }) };
}

/** `engine` (a page's `workspace`: golden-layout's config, `template` while one shows) with no entry lacking a slot; `add`, the slots it lacks. */
export function reconcile(engine: unknown, slots: Slot[]): { engine: unknown; add: Slot[] } {
  const e = obj(engine) ? { ...engine } : {}, t = obj(e['template']) ? e['template'] as TemplateState : undefined;
  if ('root' in e) e['root'] = prune(e['root'] as Item, slots);
  if (t) e['template'] = { ...t, order: t.order.map((p) => (p && shown(p, slots) ? p : null)), parked: t.parked.filter((p) => shown(p, slots)),
    ...(obj(t.dock) && 'root' in t.dock && { dock: { ...t.dock, root: prune(t.dock['root'] as Item, slots) } }) };
  const panels = t ? [...t.order.filter((p): p is PanelState => !!p), ...t.parked] : panelsInOrder(e['root']);
  return { engine: e, add: slots.filter((s) => !panels.some((p) => shown(p, [s]))) };
}

type Store = ReturnType<typeof pageStore>;
/** Keys beside golden-layout's config in a page's `workspace`: `<storage-key>.<key>` in the dock's storage. */
const BESIDE = ['template', 'window-style'];
const only = (w: Record<string, unknown>, beside: boolean) => Object.fromEntries(Object.entries(w).filter(([k]) => BESIDE.includes(k) === beside));

/** A Storage over page `id`'s `workspace`, for a dock with storage-key `key`; `quiet` makes each write (the dock's own). */
function pageStorage(store: Store, id: string, key: string, quiet: (f: () => void) => void): Storage {
  const part = (k: string) => (k === key ? '' : k.startsWith(`${key}.`) ? k.slice(key.length + 1) : undefined);
  const write = (f: (w: Record<string, unknown>) => Record<string, unknown>) => {
    const p = store.get(id);
    if (p) quiet(() => store.set({ ...p, workspace: f(obj(p['workspace']) ? p['workspace'] : {}) }));
  };
  return {
    getItem(k: string) {
      const s = part(k), p = store.get(id);
      if (s === undefined || !p) return null;
      const w = reconcile(p['workspace'], p.slots).engine as Record<string, unknown>, v = s ? w[s] : only(w, false);
      return v === undefined || (!s && !Object.keys(v as object).length) ? null : typeof v === 'string' ? v : JSON.stringify(v);
    },
    setItem(k: string, v: string) {
      const s = part(k);
      let value: unknown;
      try { value = JSON.parse(v); } catch { value = v; }
      if (s !== undefined) write((w) => (s ? { ...w, [s]: value } : { ...only(w, true), ...(value as object) }));
    },
    removeItem(k: string) { const s = part(k); if (s !== undefined) write((w) => (s ? Object.fromEntries(Object.entries(w).filter(([x]) => x !== s)) : only(w, true))); },
  } as unknown as Storage;
}

export function keepDocks(doc: Document, store: Store): void {
  const kept = new WeakSet<WorkspaceDock>(), settled = new WeakSet<WorkspaceDock>();
  let busy = false;   // a change made here: not reconciled again
  const docks = () => [...doc.querySelectorAll<WorkspaceDock>('workspace-dock')]
    .map((d) => [d, d.closest('app-route')?.getAttribute('path')?.slice(1) ?? ''] as const).filter(([, id]) => store.get(id));
  const built = (d: WorkspaceDock) => !!d.querySelector(':scope > .dock-area');
  const panels = (d: WorkspaceDock) => { const a = d.arrangement(); return a.template ? [...a.template.order.filter((p): p is PanelState => !!p), ...a.template.parked] : panelsInOrder(a.root); };
  const slots = (d: WorkspaceDock) => slotsOf(panels(d), (pod) => { const r = d.host?.data().runtimes ?? {}; return Object.keys(r).find((x) => r[x]!.pods.includes(pod)); });
  const quiet = (f: () => void) => { const was = busy; busy = true; try { f(); } finally { busy = was; } };
  const add = (d: WorkspaceDock, list: Slot[]) => quiet(() => {
    for (const s of list) try { if ('pod' in s) d.addWidget('pod', s.pod); else d.addWidget(s.view); } catch { /* a view this dock does not have */ }
  });
  const attach = () => { for (const [d, id] of docks()) if (!kept.has(d)) { kept.add(d); d.storage = pageStorage(store, id, d.getAttribute('storage-key') ?? id, quiet); } };
  const layout = () => {
    if (busy) return;
    for (const [d, id] of docks()) {
      if (!built(d)) continue;
      if (!settled.has(d)) { settled.add(d); add(d, reconcile(d.arrangement(), store.get(id)!.slots).add); }
      const p = store.get(id)!, now = slots(d);
      if (JSON.stringify(now) !== JSON.stringify(p.slots)) quiet(() => store.set({ ...p, slots: now }));
    }
  };
  const ids = (s: Slot[]) => JSON.stringify(s.map((x) => x.id).sort());
  store.subscribe(() => {
    attach();
    if (busy) return;
    for (const [d, id] of docks()) {
      const p = store.get(id)!;
      if (!built(d) || !settled.has(d) || ids(slots(d)) === ids(p.slots)) continue;
      const was = d.arrangement(), { engine, add: missing } = reconcile(was, p.slots);
      if (JSON.stringify(engine) === JSON.stringify(was)) { add(d, missing); continue; }
      // built again from its page (its arrangement now kept there, read reconciled)
      quiet(() => store.set({ ...p, workspace: was }));
      settled.delete(d);
      const parent = d.parentNode!, at = d.nextSibling;
      d.remove();
      queueMicrotask(() => parent.insertBefore(d, at));
    }
  });
  attach();
  // the app's bus, once there is one (its shell defined): docks built before then are settled at once
  const listen = () => { try { requestBus(doc.querySelector('workspace-dock')!).subscribe('dock:layout', layout); layout(); return true; } catch { return false; } };
  if (!listen()) void customElements.whenDefined('workspace-dock').then(listen);
}
