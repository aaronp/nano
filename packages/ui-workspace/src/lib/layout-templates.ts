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

/** The templates that fit exactly `count` panels; the free dock always does. */
export const enabledFor = (count: number): Set<TemplateId> =>
  new Set(TEMPLATES.filter((t) => t.positions === null || t.positions === count).map((t) => t.id));

export const swap = <T>(order: readonly T[], i: number, j: number): T[] => {
  const out = [...order];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
};

export type TemplateState = { template: TemplateId; order: PanelState[]; dock: unknown };

/** The remembered template for one dock (by its storage key); missing, junk, `dock` or a wrong panel count reads as null. */
export const templateState = (storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key: string) => ({
  get: (): TemplateState | null => {
    try {
      const s = JSON.parse(storage.getItem(`${key}.template`) ?? 'null') as TemplateState | null;
      const t = TEMPLATES.find((x) => x.id === s?.template);
      return s && t?.positions != null && Array.isArray(s.order) && s.order.length === t.positions ? s : null;
    } catch { return null; }
  },
  set: (s: TemplateState | null): void => {
    try { if (s) storage.setItem(`${key}.template`, JSON.stringify(s)); else storage.removeItem(`${key}.template`); } catch { /* storage unavailable */ }
  },
});
