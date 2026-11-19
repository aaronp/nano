/**
 * Drawer items as <workspace-dock>'s drag sources: an element whose data-widget names a palette widget can be dragged
 * into the layout to place it, or clicked to add it.
 *
 *   dragSource(el, layout, defs, id => dock.addWidget(id))
 */
import type { GoldenLayout } from 'golden-layout/dist/esm/index.js';
import type { Def } from './palette.ts';

export function dragSource(el: HTMLElement, layout: GoldenLayout, defs: ReadonlyMap<string, Def>, add: (id: string) => void) {
  const id = el.dataset['widget'] ?? '';
  const def = defs.get(id);
  if (!def) throw new Error(`menu item targets unknown workspace widget "${id}"`);
  el.setAttribute('draggable', 'false');
  layout.newDragSource(el, () => ({ type: 'component', componentType: 'widget', componentState: { widget: def.id }, title: def.title }));
  /* a link's own navigation (to the workspace page) happens first; add once the page is shown */
  el.addEventListener('click', (e) => { e.preventDefault(); requestAnimationFrame(() => add(def.id)); });
}
