/**
 * Each page's dock on its page (ADR-0036, ADR-0038). `keepDocks(doc, platform)` (a dock's route id names its page):
 * - its `storage` is its page's, under the workspace's keys (ADR-0039; other clients' keys kept as they are):
 *   `<storage-key>` is golden-layout's live config, written by the dock on every change, with `.template` and
 *   `.window-style` beside it in the page's `layout.workspace`; `.saved` and `.saved.template` (Save's restore point) are
 *   in its `meta.workspace`. Each write is one `platform.apply` (`applyPages`), the dock's own. The live layout is read
 *   reconciled with the slots; a page with slots and no layout reads as an empty one, so the dock's starting panel shows
 *   only on a page with neither;
 * - its `pods` are its page's (dock/page-pods.ts), opened when it is built (its page shown), its panels then added for
 *   the slots its layout lacks;
 * - each `dock:layout` rewrites the page's slots from its panels (`slotsOf`: each slot keeps its kind; only panels
 *   opened or closed add or drop one; view slots this dock has no widget for are kept); a pod panel back from Save's
 *   restore point whose slot was dropped since gets its `pod` slot again (its pod placed in one runtime), and opens;
 * - a change made elsewhere, to a page in the Platform's change report: a shown dock gets the slots it lacks added (and
 *   opened); if panels must go or its layout was changed, or its route is hidden, it is built again from its page (now,
 *   or on its next visit). A page whose slots resolve differently (the Application changed) is opened again.
 * Writes made here or by the dock itself are not reconciled again: `apply` is synchronous, so `quiet` sees them.
 *
 *   keepDocks(document, platform)   // workspace-pages.ts, once its docks are mounted
 */
import { ResolvedLayoutConfig } from 'golden-layout/dist/esm/index.js';
import { Coord } from '@pritzlaff/nano-core';
import type { Page, Outline, Slot } from '@pritzlaff/nano-outline';
import type { WorkspaceDock } from '../components/workspace-dock.ts';
import { requestBus } from '../lib/bus.ts';
import { panelsInOrder, type PanelState } from '../lib/layout-templates.ts';
import { applyPages, routeOf } from '../lib/pages.ts';
import { reconcile, slotOf, slotsOf } from './page-slots.ts';
import { pagePods } from './page-pods.ts';

type Instance = ReturnType<typeof Outline.create>;
type W = Record<string, unknown>;
const obj = (v: unknown): v is W => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Keys beside golden-layout's config in a page's `layout`, and those in its `meta`: `<storage-key>.<key>` in the dock's storage. */
const BESIDE = ['template', 'window-style'], META = ['saved', 'saved.template'];
/** The workspace's own entry of a page's `layout` or `meta`. */
const mine = (v: unknown): W => (obj(v) && obj(v['workspace']) ? v['workspace'] : {});
const only = (w: W, beside: boolean) => Object.fromEntries(Object.entries(w).filter(([k]) => BESIDE.includes(k) === beside));
const none = ResolvedLayoutConfig.createDefault(), EMPTY = JSON.stringify({ ...none, header: { ...none.header, popout: false } });   // no panels, as `initial` frames them
const text = JSON.stringify;

/** Page `id` of `platform` replaced by `f` of it, applied; nothing if it is gone. */
const edit = (platform: Instance, id: string, f: (p: Page) => Page) => {
  const d = platform.document().doc, p = d.pages[id];
  if (p) applyPages(platform, { ...d, pages: { ...d.pages, [id]: f(p) } });
};

/** A Storage over page `id`'s `layout` and `meta`, for a dock with storage-key `key`; `quiet` makes each write (the dock's own). */
function pageStorage(platform: Instance, id: string, key: string, quiet: (f: () => void) => void): Storage {
  const part = (k: string) => (k === key ? '' : k.startsWith(`${key}.`) ? k.slice(key.length + 1) : undefined);
  const write = (s: string, f: (w: W) => W) => quiet(() => edit(platform, id, (p) => {
    const at = META.includes(s) ? 'meta' : 'layout';
    return { ...p, [at]: { ...(obj(p[at]) ? p[at] : {}), workspace: f(mine(p[at])) } };
  }));
  return {
    getItem(k: string) {
      const s = part(k), p = platform.document().doc.pages[id];
      if (s === undefined || !p) return null;
      const w = META.includes(s) ? mine(p.meta) : reconcile(mine(p.layout), p.slots).engine as W, v = s ? w[s] : only(w, false);
      if (!s && !Object.keys(v as object).length) return Object.keys(p.slots).length ? EMPTY : null;
      return v === undefined ? null : typeof v === 'string' ? v : text(v);
    },
    setItem(k: string, v: string) {
      const s = part(k);
      let value: unknown;
      try { value = JSON.parse(v); } catch { value = v; }
      if (s !== undefined) write(s, (w) => (s ? { ...w, [s]: value } : { ...only(w, true), ...(value as object) }));
    },
    removeItem(k: string) { const s = part(k); if (s !== undefined) write(s, (w) => (s ? Object.fromEntries(Object.entries(w).filter(([x]) => x !== s)) : only(w, true))); },
  } as unknown as Storage;
}

export function keepDocks(doc: Document, platform: Instance): void {
  const kept = new WeakSet<WorkspaceDock>(), settled = new WeakSet<WorkspaceDock>(), seen = new WeakMap<WorkspaceDock, string>();
  let busy = false;   // a change made here or by a dock: not reconciled again
  const quiet = (f: () => void) => { const was = busy; busy = true; try { f(); } finally { busy = was; } };
  const pageOf = (id: string) => platform.document().doc.pages[id];
  const docks = () => [...doc.querySelectorAll<WorkspaceDock>('workspace-dock')]
    .map((d) => { const at = d.closest('app-route')?.getAttribute('path'); return [d, Object.keys(platform.document().doc.pages).find((id) => routeOf(id) === at) ?? ''] as const; }).filter(([, id]) => pageOf(id));
  const built = (d: WorkspaceDock) => !!d.querySelector(':scope > .dock-area');
  const hidden = (d: WorkspaceDock) => !!d.closest<HTMLElement>('app-route')?.hidden;
  const layoutOf = (id: string) => text(mine(pageOf(id)?.layout));
  const panels = (d: WorkspaceDock) => { const a = d.arrangement(); return a.template ? [...a.template.order.filter((p): p is PanelState => !!p), ...a.template.parked] : panelsInOrder(a.root); };
  /** Each palette widget of dock `d`: a pod's or a view; undefined, not in its palette. */
  const kinds = (d: WorkspaceDock) => {
    const of = new Map([...d.querySelectorAll<HTMLTemplateElement>(':scope > template[data-widget]')].map((t) => [t.dataset['widget']!, t.dataset['implementation'] ? 'pod' as const : 'view' as const]));
    return (w: string) => (w === 'pod' ? 'pod' as const : of.get(w));
  };
  /** Panels for slots `list` of page `id`: a pod's (named by the pod it resolves to now, if any), or a view's. */
  const addPanels = (d: WorkspaceDock, id: string, list: [string, Slot][]) => quiet(() => {
    const r = platform.resolve(id);
    for (const [s, v] of list) try {
      const to = r[s];
      if (v.kind === 'view') d.addWidget(v.view, undefined, s); else d.addWidget('pod', to?.kind === 'pod' ? to.pods[0]!.pod : undefined, s);
    } catch { /* a view this dock does not have */ }
  });
  /** Built again from its page: now if its route shows, else on its next visit. */
  const rebuild = (d: WorkspaceDock) => {
    settled.delete(d);
    const parent = d.parentNode!, at = d.nextSibling;
    d.remove();
    queueMicrotask(() => parent.insertBefore(d, at));
  };
  const attach = () => {
    for (const [d, id] of docks()) if (!kept.has(d)) {
      kept.add(d); seen.set(d, layoutOf(id));
      d.storage = pageStorage(platform, id, d.getAttribute('storage-key') ?? id, quiet);
      d.pods = pagePods(platform, id, quiet);
    }
  };
  /** The `pod` slot of a pod panel whose slot is not on the page (Restore brought it back): its pod placed in one runtime. */
  const back = (d: WorkspaceDock, q: PanelState): Slot | undefined => {
    const data = d.host?.data(), impl = q.name && data?.pods[q.name]?.implementation;
    const placed = impl ? Object.keys(data.runtimes).filter((r) => data.runtimes[r]!.pods.includes(q.name!)) : [];
    return placed.length === 1 ? { kind: 'pod', pod: Coord.pod(Coord.parse('implementation', impl as string), Coord.runtime(placed[0]!), q.name!) } : undefined;
  };
  const layout = () => {
    if (busy) return;
    for (const [d, id] of docks()) {
      if (!built(d)) continue;
      if (!settled.has(d)) { settled.add(d); addPanels(d, id, reconcile(d.arrangement(), pageOf(id)!.slots).add); d.pods?.open(); }
      const p = pageOf(id)!, kind = kinds(d), now = slotsOf(panels(d), p.slots, kind);
      const returned = panels(d).flatMap((q) => { const s = !Object.hasOwn(now, slotOf(q)) && kind(q.widget) === 'pod' && back(d, q); return s ? [[slotOf(q), s] as const] : []; });
      for (const [s, v] of returned) now[s] = v;
      if (text(now) !== text(p.slots)) quiet(() => edit(platform, id, (q) => ({ ...q, slots: now })));
      if (returned.length) d.pods?.open();
    }
  };
  platform.listen((c) => {
    attach();
    const touched = new Set([...c.added, ...c.changed, ...c.resolved]);
    for (const [d, id] of docks()) {
      if (!touched.has(id)) continue;
      const w = layoutOf(id), moved = seen.get(d) !== w;
      seen.set(d, w);
      if (busy || !built(d) || !settled.has(d)) continue;
      if (c.resolved.includes(id)) { if (hidden(d)) rebuild(d); else d.pods?.open(); }
      if (!c.added.includes(id) && !c.changed.includes(id)) continue;
      const was = d.arrangement(), { engine, add } = reconcile(was, pageOf(id)!.slots), kind = kinds(d);
      const same = text(engine) === text(was), missing = add.filter(([, s]) => s.kind !== 'view' || kind(s.view));   // a view it has no widget for stays unshown
      if (!moved && same && !missing.length) continue;
      if (!moved && same && !hidden(d)) { addPanels(d, id, missing); d.pods?.open(); }
      else rebuild(d);
    }
  });
  attach();
  // the app's bus, once there is one (its shell defined): docks built before then are settled at once
  const listen = () => { try { requestBus(doc.querySelector('workspace-dock')!).subscribe('dock:layout', layout); layout(); return true; } catch { return false; } };
  if (!listen()) void customElements.whenDefined('workspace-dock').then(listen);
}
