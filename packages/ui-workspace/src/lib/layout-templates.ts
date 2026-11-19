/** Layout templates: fixed arrangements of N panels, and the pure helpers the dock's template mode builds on. */
export type TemplateId = 'dock' | 'one' | 'two-cols' | 'two-rows' | 'main-two' | 'three-cols' | 'grid' | 'main-drawer';

export const TEMPLATES: readonly { id: TemplateId; title: string; positions: number | null; areas: string[] }[] = [
  { id: 'dock', title: 'Free dock', positions: null, areas: [] },
  { id: 'one', title: 'Single panel', positions: 1, areas: ['1'] },
  { id: 'two-cols', title: 'Two columns', positions: 2, areas: ['1', '2'] },
  { id: 'two-rows', title: 'Two rows', positions: 2, areas: ['1', '2'] },
  { id: 'main-two', title: 'Main and two', positions: 3, areas: ['main', 'top', 'bottom'] },
  { id: 'three-cols', title: 'Three columns', positions: 3, areas: ['1', '2', '3'] },
  { id: 'grid', title: 'Grid', positions: 4, areas: ['1', '2', '3', '4'] },
  { id: 'main-drawer', title: 'Main and drawer', positions: 2, areas: ['main', 'drawer'] },
];

export type PanelState = { widget: string; name?: string };

/** Component states of a golden-layout tree in reading order (row left to right, column top to bottom, stack in tab order). */
export const panelsInOrder = (root: unknown): PanelState[] => {
  const item = root as { type?: string; content?: unknown[]; componentState?: PanelState } | null;
  if (!item) return [];
  if (item.type === 'component') return item.componentState ? [item.componentState] : [];
  return (item.content ?? []).flatMap(panelsInOrder);
};

/** A template's positions (`null` = empty) and the panels parked off it. */
export type TemplateState = { template: TemplateId; order: (PanelState | null)[]; parked: PanelState[]; dock: unknown };

/** The first `positions` panels in order, padded with empty positions; the rest parked. */
export const place = (panels: readonly PanelState[], positions: number): { order: (PanelState | null)[]; parked: PanelState[] } => ({
  order: Array.from({ length: positions }, (_, i) => panels[i] ?? null),
  parked: panels.slice(positions),
});

/** `s` in template `to`: placed panels (reading order) then the parked ones, through `place`. */
export const relayout = (s: TemplateState, to: TemplateId): TemplateState =>
  ({ ...s, template: to, ...place([...s.order.filter((p) => p !== null), ...s.parked], TEMPLATES.find((t) => t.id === to)?.positions ?? 0) });

/** The smallest template holding `count` panels; ties prefer `current`, else the first in TEMPLATES; none fits: `dock`. */
export const bringBackTo = (count: number, current: TemplateId): TemplateId => {
  const fit = TEMPLATES.filter((t) => t.positions != null && t.positions >= count);
  const min = Math.min(...fit.map((t) => t.positions!));
  const best = fit.filter((t) => t.positions === min);
  return (best.find((t) => t.id === current) ?? best[0])?.id ?? 'dock';
};

/** The remembered template for one dock (by its storage key); missing, junk, `dock` or a wrong panel count reads as null. */
export const templateState = (storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key: string) => ({
  get: (): TemplateState | null => {
    try {
      const s = JSON.parse(storage.getItem(`${key}.template`) ?? 'null') as TemplateState | null;
      const t = TEMPLATES.find((x) => x.id === s?.template);
      return s && t?.positions != null && Array.isArray(s.order) && s.order.length === t.positions ? { ...s, parked: s.parked ?? [] } : null;
    } catch { return null; }
  },
  set: (s: TemplateState | null): void => {
    try { if (s) storage.setItem(`${key}.template`, JSON.stringify(s)); else storage.removeItem(`${key}.template`); } catch { /* storage unavailable */ }
  },
});
