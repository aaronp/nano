/**
 * <workspace-dock>'s template mode: its panels in a fixed CSS grid, one position per template area. A filled position has a
 * thin header (its title, from `title`, a native select of positions, choosing one swaps the two positions, and ✕, which
 * empties it); an empty one shows the picker's grid inline. At ≤840px the grid stacks; `main-drawer`'s drawer becomes a slide-over,
 * toggled by a button.
 *
 *   const view = renderTemplate(area, 'two-cols', order, state => title, (el, state, item) => mountPanel(item.container, state, …), { swap, add, remove })
 *   view.set(1, { widget: 'notes' }); view.panel(1)?.focus(); view.states(); view.dispose()
 */
import type { ComponentContainer, ComponentItem } from 'golden-layout/dist/esm/index.js';
import { TEMPLATES, type PanelState, type TemplateId } from '../lib/layout-templates.ts';

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
.dock-template .tpl-pos.empty { grid-template-rows: minmax(0, 1fr); border-style: dashed; background: none; }
.dock-template .tpl-head { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; font: 12px var(--font); color: var(--muted); border-bottom: 1px solid var(--line); }
.dock-template .tpl-head span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dock-template .tpl-head button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
.dock-template .tpl-pos.empty { overflow: auto; }
.dock-template .tpl-toggle { display: none; }
.dock-notice { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 4; display: flex; align-items: center; gap: 8px; padding: 6px 10px; font: 12px var(--font); color: var(--fg); background: var(--surface-2); border: 1px solid var(--line); border-radius: 6px; }
.dock-notice[hidden] { display: none; }
.dock-notice button { font: inherit; color: var(--accent); background: none; border: 0; cursor: pointer; }
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

type Positions = { swap(i: number, j: number): void; add(i: number, host: HTMLElement): void; remove(i: number): void; named(): void };
const button = (doc: Document, className: string, text: string, label: string) => {
  const b = Object.assign(doc.createElement('button'), { type: 'button', className, textContent: text, title: label });
  b.setAttribute('aria-label', label);
  return b;
};

/** Shows `order` in template `t` inside `host`, each panel mounted once: `mount` fills a position's panel element, given a
 * stand-in for golden-layout's item (its container: element, on('destroy'), focus, stateRequestEvent). Choosing a position
 * moves the two in place, then `on.swap`; an empty position calls `on.add` with itself, to show the picker's grid in, a ✕ `on.remove`; a panel's state changing (its new pod
 * named: the container's `stateChanged`) `on.named`. `set(i, state)` refills position i;
 * `states()` reads each panel's current state; `dispose()` fires every panel's destroy and removes the grid. */
export function renderTemplate(host: HTMLElement, t: TemplateId, order: readonly (PanelState | null)[], title: (s: PanelState) => string, mount: (el: HTMLElement, state: PanelState, item: ComponentItem) => void, on: Positions) {
  const doc = host.ownerDocument;
  ensureStyles(doc);
  const areas = TEMPLATES.find((x) => x.id === t)?.areas ?? [];
  const grid = Object.assign(doc.createElement('div'), { className: 'dock-template' });
  grid.dataset['template'] = t;
  const positions: HTMLElement[] = [], destroys = new Map<HTMLElement, (() => void)[]>(), containers = new Map<HTMLElement, { initialState: PanelState; stateRequestEvent?: () => unknown }>();
  const place = (pos: HTMLElement, area: string) => { pos.dataset['area'] = area; pos.style.gridArea = `a-${area}`; const s = pos.querySelector('select'); if (s) s.value = area; };
  const fill = (pos: HTMLElement, state: PanelState | null) => {
    for (const f of destroys.get(pos) ?? []) f();
    destroys.set(pos, []); containers.delete(pos); pos.replaceChildren();
    pos.classList.toggle('empty', !state);
    if (!state) {
      on.add(positions.indexOf(pos), pos);
      return;
    }
    const head = pos.appendChild(Object.assign(doc.createElement('header'), { className: 'tpl-head' }));
    head.append(Object.assign(doc.createElement('span'), { textContent: title(state) }));
    const select = head.appendChild(doc.createElement('select'));
    select.setAttribute('aria-label', 'Position');
    for (const a of areas) select.append(Object.assign(doc.createElement('option'), { value: a, textContent: a }));
    select.addEventListener('change', () => {
      const a = positions.indexOf(pos), b = areas.indexOf(select.value);
      [positions[a], positions[b]] = [positions[b]!, pos];
      place(positions[a]!, areas[a]!); place(pos, areas[b]!);
      on.swap(a, b);
    });
    head.append(button(doc, 'tpl-remove', '✕', `Remove ${title(state)}`));
    head.lastElementChild!.addEventListener('click', () => on.remove(positions.indexOf(pos)));
    const element = pos.appendChild(Object.assign(doc.createElement('div'), { tabIndex: -1 }));
    const container = { element, initialState: state, focus() {}, stateRequestEvent: undefined, on(e: string, f: () => void) { if (e === 'destroy') destroys.get(pos)!.push(f); }, emit(e: string) { if (e === 'stateChanged') on.named(); } };
    containers.set(pos, container);
    mount(element, state, { container: container as unknown as ComponentContainer } as unknown as ComponentItem);
  };
  areas.forEach((area, i) => {
    const pos = grid.appendChild(Object.assign(doc.createElement('section'), { className: 'tpl-pos' }));
    positions.push(pos); fill(pos, order[i] ?? null); place(pos, area);
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
  return {
    set(i: number, state: PanelState | null) { fill(positions[i]!, state); place(positions[i]!, areas[i]!); },
    /** Position i's panel element, if filled. */
    panel: (i: number) => positions[i]?.querySelector<HTMLElement>(':scope > div') ?? null,
    /** Each position's panel state as it is now (an implementation's panel names its pod once made), null when empty. */
    states: (): (PanelState | null)[] => positions.map((pos) => { const c = containers.get(pos); return c ? (c.stateRequestEvent?.() as PanelState | undefined) ?? c.initialState : null; }),
    dispose() { for (const pos of positions) for (const f of destroys.get(pos) ?? []) f(); grid.remove(); },
  };
}
