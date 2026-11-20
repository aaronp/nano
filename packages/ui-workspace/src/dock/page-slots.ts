/**
 * A dock on its page (ADR-0038): the page's `slots` are the truth, the dock's engine state (its page's `layout`) a hint
 * under them. A panel names the slot it shows (`slotOf`). Pure over the data: `slotsOf` reads the page's slots from a
 * dock's panels; `reconcile` drops engine entries that have no slot and returns the slots the engine lacks, to be split
 * in. dock/page-docks.ts applies them.
 *
 *   slotsOf([{ widget: 'pod', name: 'log2', slot: 'any' }, { widget: 'notes' }], page.slots, kind)   // { any: <its select>, notes: { kind: 'view', view: 'notes' } }
 *   const { engine, add } = reconcile(page.layout, page.slots)
 */
import type { Slot } from '@pritzlaff/nano-platform';
import { panelsInOrder, type PanelState, type TemplateState } from '../lib/layout-templates.ts';

type Slots = Record<string, Slot>;
type Item = { type?: string; content?: Item[]; activeItemIndex?: number; componentState?: unknown };
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The slot a panel shows: its `slot`; in a layout from before panels carried it, its pod's name, else its widget. */
export const slotOf = (p: PanelState): string => p.slot ?? p.name ?? p.widget;
const shown = (p: PanelState, slots: Slots) => Object.hasOwn(slots, slotOf(p));

/**
 * The page's `slots` as a dock's panels have them, in the page's order: each slot a panel shows, kept as it is (a
 * `select` stays one); a view slot whose widget the dock lacks (`kind` undefined), kept; a slot no panel shows, dropped
 * (its panel was closed); a newly opened view panel's slot added. A pod panel adds none: a pick applies its slot first.
 */
export function slotsOf(panels: PanelState[], slots: Slots, kind: (widget: string) => 'pod' | 'view' | undefined): Slots {
  const ids = new Set(panels.map(slotOf));
  const kept = Object.entries(slots).filter(([id, s]) => ids.has(id) || (s.kind === 'view' && !kind(s.view)));
  const added = panels.filter((p) => !Object.hasOwn(slots, slotOf(p)) && kind(p.widget) === 'view').map((p): [string, Slot] => [slotOf(p), { kind: 'view', view: p.widget }]);
  return Object.fromEntries([...kept, ...added]);
}

/** golden-layout's tree without the panels that have no slot, and without the containers that left empty. */
function prune(item: Item | undefined, slots: Slots): Item | undefined {
  if (!obj(item)) return undefined;
  if (item.type === 'component') return shown(item.componentState as PanelState, slots) ? item : undefined;
  const content = (item.content ?? []).map((i) => prune(i, slots)).filter((i): i is Item => !!i);
  if (!content.length) return undefined;
  return { ...item, content, ...(item.activeItemIndex !== undefined && { activeItemIndex: Math.min(item.activeItemIndex, content.length - 1) }) };
}

/** `engine` (a page's `layout`: golden-layout's config, `template` while one shows) with no entry lacking a slot; `add`, the slots it lacks. */
export function reconcile(engine: unknown, slots: Slots): { engine: unknown; add: [string, Slot][] } {
  const e = obj(engine) ? { ...engine } : {}, t = obj(e['template']) ? e['template'] as TemplateState : undefined;
  if ('root' in e) e['root'] = prune(e['root'] as Item, slots);
  if (t) e['template'] = { ...t, order: t.order.map((p) => (p && shown(p, slots) ? p : null)), parked: t.parked.filter((p) => shown(p, slots)),
    ...(obj(t.dock) && 'root' in t.dock && { dock: { ...t.dock, root: prune(t.dock['root'] as Item, slots) } }) };
  const panels = new Set((t ? [...t.order.filter((p): p is PanelState => !!p), ...t.parked] : panelsInOrder(e['root'])).map(slotOf));
  return { engine: e, add: Object.entries(slots).filter(([id]) => !panels.has(id)) };
}
