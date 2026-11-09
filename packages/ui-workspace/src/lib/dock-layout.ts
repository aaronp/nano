/**
 * Pure helpers for the golden-layout workspace: panel state, starting layouts and counting panels.
 * Layout objects here are plain JSON (golden-layout's LayoutConfig shape), so they can be saved and tested.
 */

/** How the panels open at start are arranged. */
export type Arrangement = 'row' | 'column' | 'stack' | 'grid';
export const ARRANGEMENTS: readonly Arrangement[] = ['row', 'column', 'stack', 'grid'];

export interface PaletteEntry {
  /** Kebab-case id; saved layouts refer to panels by this id, never by markup. */ readonly id: string;
  /** Tab title and drawer label. */ readonly title: string;
}

export interface ComponentItem {
  readonly type: 'component';
  readonly componentType: 'widget';
  readonly componentState: { readonly widget: string };
  readonly title: string;
}
export interface GroupItem { readonly type: 'row' | 'column' | 'stack'; readonly content: readonly LayoutItem[] }
export type LayoutItem = ComponentItem | GroupItem;

export const PALETTE_ID = /^[a-z][a-z0-9-]*$/;

export const panel = (e: PaletteEntry): ComponentItem =>
  ({ type: 'component', componentType: 'widget', componentState: { widget: e.id }, title: e.title });

/** The widget id stored in a panel's state. Throws on anything else, so a corrupt saved layout fails loudly. */
export const readWidgetId = (state: unknown): string => {
  const w = typeof state === 'object' && state !== null && !Array.isArray(state) ? (state as Record<string, unknown>)['widget'] : undefined;
  if (typeof w === 'string' && PALETTE_ID.test(w)) return w;
  throw new Error(`workspace panel state must be { "widget": "<id>" }, got ${JSON.stringify(state)}`);
};

/** The instance a panel's element shows, if the panel names one (a component reopened from the rack). */
export const readWidgetName = (state: unknown): string | undefined => {
  const n = typeof state === 'object' && state !== null ? (state as Record<string, unknown>)['name'] : undefined;
  return typeof n === 'string' && n ? n : undefined;
};

/** A starting layout: the given entries arranged side by side, stacked, as tabs, or in a two-column grid. */
export const initialLayout = (entries: readonly PaletteEntry[], arrangement: Arrangement): { readonly root: LayoutItem } => {
  const items = entries.map(panel);
  const first = items[0];
  if (!first) throw new Error('a workspace needs at least one panel open at start');
  if (items.length === 1) return { root: first };
  switch (arrangement) {
    case 'row': case 'column': case 'stack': return { root: { type: arrangement, content: items } };
    case 'grid': {
      const half = Math.ceil(items.length / 2);
      const col = (xs: readonly ComponentItem[]): LayoutItem => (xs.length === 1 && xs[0] ? xs[0] : { type: 'column', content: xs });
      return { root: { type: 'row', content: [col(items.slice(0, half)), col(items.slice(half))] } };
    }
    default: throw new Error(`unknown arrangement ${String(arrangement)}`);
  }
};

/** Number of panels in a (saved or initial) layout tree. */
export const countPanels = (item: { readonly type: string; readonly content?: readonly unknown[] } | undefined | null): number => {
  if (!item) return 0;
  if (item.type === 'component') return 1;
  return (item.content ?? []).reduce<number>((n, c) => n + countPanels(c as { type: string; content?: readonly unknown[] }), 0);
};

/** Ids of every panel in a layout tree, in order (used to validate a saved layout against the palette). */
export const panelIds = (item: { readonly type: string; readonly content?: readonly unknown[]; readonly componentState?: unknown } | undefined | null): readonly string[] => {
  if (!item) return [];
  if (item.type === 'component') return [readWidgetId(item.componentState)];
  return (item.content ?? []).flatMap((c) => panelIds(c as { type: string; content?: readonly unknown[]; componentState?: unknown }));
};
