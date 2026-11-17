/**
 * Pure helpers for the golden-layout workspace: panel state, starting layouts and counting panels.
 * Layout objects here are plain JSON (golden-layout's LayoutConfig shape), so they can be saved and tested.
 */
/** A rectangle as fractions of the page, each in [0, 1] (was @pritzlaff/nano-app's Box). */
type Box = { x: number; y: number; w: number; h: number };

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

/** Which instance each panel of a saved layout shows (panels with no instance are skipped), with the page box it fills
 * (fractions of the page, from the saved sizes) and, in a stack, its tab. A panel is named by its id, else its title and
 * index path; anything that isn't a layout gives []. */
export const placementsOf = (layout: unknown): { panel: string; instance: string; box: Box; tab?: { group: string; active: boolean } }[] => {
  type Item = { type?: unknown; content?: unknown; id?: unknown; title?: unknown; componentState?: unknown; size?: unknown; sizeUnit?: unknown; activeItemIndex?: unknown };
  const obj = (x: unknown): Item | undefined => (typeof x === 'object' && x !== null ? (x as Item) : undefined);
  const kids = (it: Item): unknown[] => (Array.isArray(it.content) ? it.content : []);
  /** Each child's share of the parent's extent: '%' as a percentage, 'fr' as a fraction of the total fr, unsized equal
   * shares of the remainder; normalised to sum to 1. */
  const shares = (cs: unknown[]): number[] => {
    const sized = cs.map((c) => { const o = obj(c); return o && typeof o.size === 'number' && o.size > 0 ? { size: o.size, fr: o.sizeUnit === 'fr' } : undefined });
    const pctSum = sized.reduce((n: number, r) => n + (r && !r.fr ? r.size / 100 : 0), 0);
    const frSum = sized.reduce((n: number, r) => n + (r?.fr ? r.size : 0), 0);
    const unsized = sized.filter((r) => !r).length;
    const left = Math.max(0, 1 - pctSum);
    const w = sized.map((r) => (!r ? (unsized ? left / unsized : 0) : r.fr ? (left * r.size) / frSum : r.size / 100));
    const total = w.reduce((n: number, x) => n + x, 0);
    return total > 0 ? w.map((x) => x / total) : cs.map(() => 1 / cs.length);
  };
  const walk = (item: unknown, path: number[], box: Box, group?: { id: string; active: number }, index = 0): ReturnType<typeof placementsOf> => {
    const it = obj(item);
    if (!it) return [];
    if (it.type === 'component') {
      const instance = readWidgetName(it.componentState);
      if (!instance) return [];
      return [{ panel: (typeof it.id === 'string' && it.id) || `${typeof it.title === 'string' ? it.title : ''}@${path.join('.')}`, instance, box,
        ...(group && { tab: { group: group.id, active: index === group.active } }) }];
    }
    const cs = kids(it);
    if (it.type === 'stack') {
      const active = typeof it.activeItemIndex === 'number' ? it.activeItemIndex : 0;
      return cs.flatMap((c, i) => walk(c, [...path, i], box, { id: path.join('.'), active }, i));
    }
    if (it.type !== 'row' && it.type !== 'column') return cs.flatMap((c, i) => walk(c, [...path, i], box));
    const horizontal = it.type === 'row';
    let at = horizontal ? box.x : box.y;
    return cs.flatMap((c, i) => {
      const s = shares(cs)[i] ?? 0, len = (horizontal ? box.w : box.h) * s, start = at;
      at += len;
      return walk(c, [...path, i], horizontal ? { ...box, x: start, w: len } : { ...box, y: start, h: len });
    });
  };
  return walk((layout as { root?: unknown } | null)?.root, [0], { x: 0, y: 0, w: 1, h: 1 });
};

/** The deploy mode a panel was saved with, if it has one (missing: the panel shows the host's element as before). */
export const readWidgetMode = (state: unknown): string | undefined => {
  const m = typeof state === 'object' && state !== null ? (state as Record<string, unknown>)['mode'] : undefined;
  return typeof m === 'string' && m ? m : undefined;
};

/** A panel's saved state: its widget, the instance its element shows (if it shows one), to reattach to, and the deploy mode it shows it in. */
export const panelState = (widget: string, shown: { model?: unknown; name?: unknown; mode?: unknown } | null): { widget: string; name?: string; mode?: string } => {
  const name = shownInstance(shown);
  return { widget, ...(name && { name }), ...(typeof shown?.mode === 'string' && shown.mode && { mode: shown.mode }) };
};

/** The instance a panel's element shows (its model, else its name), if any. */
export const shownInstance = (shown: { model?: unknown; name?: unknown } | null): string | undefined =>
  [shown?.model, shown?.name].find((n): n is string => typeof n === 'string' && !!n);

/** A starting layout: the given entries arranged side by side, stacked, as tabs, or in a two-column grid. With no
 * entries the workspace starts empty. */
export const initialLayout = (entries: readonly PaletteEntry[], arrangement: Arrangement): { readonly root: LayoutItem | undefined } => {
  const items = entries.map(panel);
  const first = items[0];
  if (!first) return { root: undefined };
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

/** How panels are framed: with tabs, or clear (a lone panel has no tab, and its controls show on hover). */
export const WINDOW_STYLES = [{ id: 'tabs', title: 'Tabs' }, { id: 'focus', title: 'Clear' }] as const;
export type WindowStyle = (typeof WINDOW_STYLES)[number]['id'];

/** The remembered window style for one dock (by its storage key); anything unknown reads as tabs. */
export const windowStyle = (storage: Pick<Storage, 'getItem' | 'setItem'>, key: string) => ({
  get: (): WindowStyle => { const v = storage.getItem(`${key}.window-style`); return WINDOW_STYLES.some((s) => s.id === v) ? (v as WindowStyle) : 'tabs'; },
  set: (style: WindowStyle) => storage.setItem(`${key}.window-style`, style),
});
