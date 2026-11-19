/**
 * <workspace-dock>'s template mode: its panels in a fixed CSS grid, one position per template area. Each position has a
 * thin header (its title and a native select of positions; choosing one swaps the two panels). At ≤840px the grid
 * stacks; `main-drawer`'s drawer becomes a slide-over, toggled by a button.
 *
 *   const dispose = renderTemplate(area, 'two-cols', order, (el, state) => unmount, (i, j) => swapped)
 *   const { container, destroy } = standIn(el, state, item => focused(item))   // for mountPanel
 *   const why = refusal('grid', order, defs)   // undefined when the template can show these panels
 */
import type { ComponentContainer, ComponentItem } from 'golden-layout/dist/esm/index.js';
import { TEMPLATES, enabledFor, type PanelState, type TemplateId } from '../lib/layout-templates.ts';
import type { Def } from './palette.ts';

const STYLE_ID = 'workspace-dock-template-styles';
const CSS = `
.dock-template { position: absolute; inset: 0; z-index: 1; display: grid; gap: 6px; padding: 6px; box-sizing: border-box; background: var(--bg); }
.dock-template[data-template="one"] { grid-template: "a-1" 1fr / 1fr; }
.dock-template[data-template="two-cols"] { grid-template: "a-1 a-2" 1fr / 1fr 1fr; }
.dock-template[data-template="two-rows"] { grid-template: "a-1" 1fr "a-2" 1fr / 1fr; }
.dock-template[data-template="main-two"] { grid-template: "a-main a-top" 1fr "a-main a-bottom" 1fr / 2fr 1fr; }
.dock-template[data-template="three-cols"] { grid-template: "a-1 a-2 a-3" 1fr / 1fr 1fr 1fr; }
.dock-template[data-template="grid"] { grid-template: "a-1 a-2" 1fr "a-3 a-4" 1fr / 1fr 1fr; }
.dock-template[data-template="main-drawer"] { grid-template: "a-main a-drawer" 1fr / 1fr minmax(240px, 30%); }
.dock-template .tpl-pos { display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; min-height: 0; border: 1px solid var(--line); background: var(--surface); }
.dock-template .tpl-head { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; font: 12px var(--font); color: var(--muted); border-bottom: 1px solid var(--line); }
.dock-template .tpl-head span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dock-template .tpl-toggle { display: none; }
@media (max-width: 840px) {
  .dock-template:not([data-template="main-drawer"]) { grid-template: none; grid-auto-rows: minmax(240px, 1fr); overflow: auto; }
  .dock-template:not([data-template="main-drawer"]) .tpl-pos { grid-area: auto !important; }
  .dock-template[data-template="main-drawer"] { grid-template: "a-main" 1fr / 1fr; }
  .dock-template[data-template="main-drawer"] .tpl-pos[data-area="drawer"] { position: absolute; top: 0; right: 0; bottom: 0; width: min(85%, 360px); z-index: 2; transform: translateX(100%); transition: transform .2s; }
  .dock-template[data-template="main-drawer"][data-open] .tpl-pos[data-area="drawer"] { transform: none; box-shadow: 0 10px 30px rgb(0 0 0 / .25); }
  .dock-template .tpl-toggle { display: block; position: absolute; right: 10px; bottom: 10px; z-index: 3; }
}
`;

const ensureStyles = (doc: Document) => {
  if (doc.getElementById(STYLE_ID)) return;
  const style = Object.assign(doc.createElement('style'), { id: STYLE_ID, textContent: CSS });
  doc.head.append(style);
};

/** Shows `order` in template `t` inside `host`; `mount` fills a position's panel element and returns its unmount. Returns
 * the dispose, which unmounts every panel and removes the grid. */
export function renderTemplate(host: HTMLElement, t: TemplateId, order: PanelState[], mount: (el: HTMLElement, state: PanelState) => () => void, onSwap: (i: number, j: number) => void): () => void {
  const doc = host.ownerDocument;
  ensureStyles(doc);
  const areas = TEMPLATES.find((x) => x.id === t)?.areas ?? [];
  const grid = Object.assign(doc.createElement('div'), { className: 'dock-template' });
  grid.dataset['template'] = t;
  const unmounts = areas.map((area, i) => {
    const state = order[i]!;
    const pos = grid.appendChild(Object.assign(doc.createElement('section'), { className: 'tpl-pos' }));
    pos.dataset['area'] = area;
    pos.style.gridArea = `a-${area}`;
    const head = pos.appendChild(Object.assign(doc.createElement('header'), { className: 'tpl-head' }));
    head.append(Object.assign(doc.createElement('span'), { textContent: state.name ?? state.widget }));
    const select = head.appendChild(doc.createElement('select'));
    select.setAttribute('aria-label', 'Position');
    for (const a of areas) select.append(Object.assign(doc.createElement('option'), { value: a, textContent: a }));
    select.value = area;
    select.addEventListener('change', () => onSwap(i, areas.indexOf(select.value)));
    const el = pos.appendChild(Object.assign(doc.createElement('div'), { tabIndex: -1 }));
    return mount(el, state);
  });
  if (t === 'main-drawer') {
    const toggle = grid.appendChild(Object.assign(doc.createElement('button'), { className: 'tpl-toggle', type: 'button', textContent: 'Drawer' }));
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      grid.toggleAttribute('data-open', open);
    });
  }
  host.append(grid);
  return () => { for (const u of unmounts) u(); grid.remove(); };
}

/** A stand-in for golden-layout's container around a position's panel element, so mountPanel fills it as in the dock;
 * `destroy` fires what it registered for destroy. A click or focus in it reports it (as golden-layout's item) to `focus`. */
export function standIn(element: HTMLElement, state: PanelState, focus: (item: ComponentItem) => void) {
  const destroys: (() => void)[] = [];
  const container = { element, initialState: state, focus() {}, stateRequestEvent: undefined, on(e: string, f: () => void) { if (e === 'destroy') destroys.push(f); } };
  const item = { container } as unknown as ComponentItem;
  for (const type of ['pointerdown', 'focusin']) element.addEventListener(type, () => focus(item));
  return { container: container as unknown as ComponentContainer, destroy: () => { for (const f of destroys) f(); } };
}

/** Why template `id` cannot show `order`: the count does not fit, or an implementation's pod is still being made. */
export function refusal(id: TemplateId, order: PanelState[], defs: ReadonlyMap<string, Def>): string | undefined {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t || !enabledFor(order.length).has(id)) return `${t?.title ?? id} needs ${t?.positions} panels; this page has ${order.length}.`;
  if (order.some((s) => defs.get(s.widget)?.template.dataset['implementation'] && !s.name)) return 'Wait until every new pod is made.';
  return undefined;
}
