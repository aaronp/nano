/**
 * Each page's dock on its page (ADR-0032, ADR-0036). `keepDocks(doc, store)` (a dock's route id names its page):
 * - its `storage` is the page's `workspace` key, written with `store.set`: `<storage-key>` is golden-layout's live
 *   config, written by the dock on every change; `.template`, `.window-style`, `.saved` and `.saved.template` (Save's
 *   restore point) sit beside it. The live layout is read reconciled with the slots; a page with slots and no layout
 *   reads as an empty one, so the dock's starting panel shows only on a page with neither.
 * - built (its page shown), the slots its layout lacks are added;
 * - each `dock:layout` rewrites the page's slots from its panels: a known slot keeps its runtime, and the page's view
 *   slots this dock has no widget for are kept;
 * - a store change made elsewhere: a shown dock gets the slots it lacks added; if panels must go or its layout was
 *   changed, or its route is hidden, it is built again from its page (now, or on its next visit).
 * Writes made here or by the dock itself are not reconciled again.
 *
 *   keepDocks(document, pages)   // workspace-pages.ts, once its docks are mounted
 */
import { ResolvedLayoutConfig } from 'golden-layout/dist/esm/index.js';
import type { LayoutSlot, ViewSlot } from '@pritzlaff/nano-ui';
import type { WorkspaceDock } from '../components/workspace-dock.ts';
import { requestBus } from '../lib/bus.ts';
import { panelsInOrder, type PanelState } from '../lib/layout-templates.ts';
import type { pageStore } from '../lib/pages.ts';
import { reconcile, slotsOf } from './page-slots.ts';

type Store = ReturnType<typeof pageStore>;
type Slot = LayoutSlot | ViewSlot;
type W = Record<string, unknown>;
const obj = (v: unknown): v is W => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Keys beside golden-layout's config in a page's `workspace`: `<storage-key>.<key>` in the dock's storage. */
const BESIDE = ['template', 'window-style', 'saved', 'saved.template'];
const only = (w: W, beside: boolean) => Object.fromEntries(Object.entries(w).filter(([k]) => BESIDE.includes(k) === beside));
const none = ResolvedLayoutConfig.createDefault(), EMPTY = JSON.stringify({ ...none, header: { ...none.header, popout: false } });   // no panels, as `initial` frames them

/** A Storage over page `id`'s `workspace`, for a dock with storage-key `key`; `quiet` makes each write (the dock's own). */
function pageStorage(store: Store, id: string, key: string, quiet: (f: () => void) => void): Storage {
  const part = (k: string) => (k === key ? '' : k.startsWith(`${key}.`) ? k.slice(key.length + 1) : undefined);
  const write = (f: (w: W) => W) => { const p = store.get(id); if (p) quiet(() => store.set({ ...p, workspace: f(obj(p['workspace']) ? p['workspace'] : {}) })); };
  return {
    getItem(k: string) {
      const s = part(k), p = store.get(id);
      if (s === undefined || !p) return null;
      const w = reconcile(p['workspace'], p.slots).engine as W, v = s ? w[s] : only(w, false);
      if (!s && !Object.keys(v as object).length) return p.slots.length ? EMPTY : null;
      return v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v);
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
  const kept = new WeakSet<WorkspaceDock>(), settled = new WeakSet<WorkspaceDock>(), seen = new WeakMap<WorkspaceDock, string>();
  let busy = false;   // a change made here or by a dock: not reconciled again
  const quiet = (f: () => void) => { const was = busy; busy = true; try { f(); } finally { busy = was; } };
  const docks = () => [...doc.querySelectorAll<WorkspaceDock>('workspace-dock')]
    .map((d) => [d, d.closest('app-route')?.getAttribute('path')?.slice(1) ?? ''] as const).filter(([, id]) => store.get(id));
  const built = (d: WorkspaceDock) => !!d.querySelector(':scope > .dock-area');
  const layoutOf = (id: string) => JSON.stringify(store.get(id)?.['workspace'] ?? null);
  const panels = (d: WorkspaceDock) => { const a = d.arrangement(); return a.template ? [...a.template.order.filter((p): p is PanelState => !!p), ...a.template.parked] : panelsInOrder(a.root); };
  /** The page's slots as dock `d` has them: from its panels, a known slot's runtime kept; the view slots it has no widget for. */
  const slots = (d: WorkspaceDock, page: Slot[]): Slot[] => {
    const r = d.host?.data().runtimes ?? {}, placed = (rt: string | undefined, pod: string) => !!rt && !!r[rt]?.pods.includes(pod);
    const runtimeOf = (pod: string) => { const known = page.find((s): s is LayoutSlot => 'pod' in s && s.pod === pod)?.runtime; return placed(known, pod) ? known : Object.keys(r).find((x) => placed(x, pod)); };
    const unseen = page.filter((s) => 'view' in s && ![...d.querySelectorAll<HTMLTemplateElement>(':scope > template[data-widget]')].some((t) => t.dataset['widget'] === s.view));
    return [...slotsOf(panels(d), runtimeOf), ...unseen];
  };
  const ids = (s: Slot[]) => JSON.stringify(s.map((x) => x.id).sort());
  const add = (d: WorkspaceDock, list: Slot[]) => quiet(() => {
    for (const s of list) try { if ('pod' in s) d.addWidget('pod', s.pod); else d.addWidget(s.view); } catch { /* a view this dock does not have */ }
  });
  /** Built again from its page: now if its route shows, else on its next visit. */
  const rebuild = (d: WorkspaceDock) => {
    settled.delete(d);
    const parent = d.parentNode!, at = d.nextSibling;
    d.remove();
    queueMicrotask(() => parent.insertBefore(d, at));
  };
  const attach = () => {
    for (const [d, id] of docks()) if (!kept.has(d)) { kept.add(d); seen.set(d, layoutOf(id)); d.storage = pageStorage(store, id, d.getAttribute('storage-key') ?? id, quiet); }
  };
  const layout = () => {
    if (busy) return;
    for (const [d, id] of docks()) {
      if (!built(d)) continue;
      if (!settled.has(d)) { settled.add(d); add(d, reconcile(d.arrangement(), store.get(id)!.slots).add); }
      const p = store.get(id)!, now = slots(d, p.slots);
      if (JSON.stringify(now) !== JSON.stringify(p.slots)) quiet(() => store.set({ ...p, slots: now }));
    }
  };
  store.subscribe(() => {
    attach();
    for (const [d, id] of docks()) {
      const p = store.get(id)!, w = layoutOf(id), moved = seen.get(d) !== w;
      seen.set(d, w);
      if (busy || !built(d) || !settled.has(d) || (!moved && ids(slots(d, p.slots)) === ids(p.slots))) continue;
      const was = d.arrangement(), { engine, add: missing } = reconcile(was, p.slots);
      if (!moved && !d.closest<HTMLElement>('app-route')?.hidden && JSON.stringify(engine) === JSON.stringify(was)) add(d, missing);
      else rebuild(d);
    }
  });
  attach();
  // the app's bus, once there is one (its shell defined): docks built before then are settled at once
  const listen = () => { try { requestBus(doc.querySelector('workspace-dock')!).subscribe('dock:layout', layout); layout(); return true; } catch { return false; } };
  if (!listen()) void customElements.whenDefined('workspace-dock').then(listen);
}
