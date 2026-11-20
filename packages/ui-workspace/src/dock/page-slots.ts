/**
 * A dock on its page (ADR-0032): the page's `slots` are the truth, the dock's engine state (its page's `workspace` key)
 * a hint under them. Pure over the data: `slotsOf` reads slots from a dock's panels; `reconcile` drops engine entries
 * that have no slot and returns the slots the engine lacks, to be split in. dock/page-docks.ts applies them.
 *
 *   slotsOf([{ widget: 'pod', name: 'clock1' }, { widget: 'notes' }], runtimeOf)   // [{ id: 'clock1', runtime: 'main', pod: 'clock1' }, { id: 'notes', view: 'notes' }]
 *   const { engine, add } = reconcile(page.workspace, page.slots)
 */
import type { LayoutSlot, ViewSlot } from '@pritzlaff/nano-ui';
import { panelsInOrder, type PanelState, type TemplateState } from '../lib/layout-templates.ts';

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

