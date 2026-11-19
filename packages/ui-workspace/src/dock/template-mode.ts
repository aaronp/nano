/**
 * <workspace-dock>'s template mode: a `TemplateState` shown by template-view.ts, kept as it changes. An empty position's
 * `+` opens the picker (parked panels listed first) and fills it; ✕ empties one; while panels are parked a notice above
 * the layout says how many, with Bring back (and ✕, which hides it until the count changes).
 *
 *   const mode = showTemplate(area, state, { title, mount, pick, remember, bringBack })
 *   mode.state; mode.add(panel); mode.backToDock(layout, panel => split(…)); mode.dispose()
 */
import type { ComponentItem, ContentItem, GoldenLayout } from 'golden-layout/dist/esm/index.js';
import { bringBackTo, panelsInOrder, type PanelState, type TemplateId, type TemplateState } from '../lib/layout-templates.ts';
import { renderTemplate } from './template-view.ts';

type Needs = {
  title(p: PanelState): string;
  mount(el: HTMLElement, p: PanelState, item: ComponentItem): void;
  pick(anchor: HTMLElement, hidden: PanelState[]): Promise<PanelState | null>;
  /** Stores the state as it now is (and tells whoever listens). */
  remember(s: TemplateState): void;
  bringBack(to: TemplateId): void;
};

const same = (a: PanelState, b: PanelState) => a.widget === b.widget && a.name === b.name;
/** The parked count whose notice was dismissed, per dock area: hidden until the count changes. */
const dismissed = new WeakMap<HTMLElement, number>();

export function showTemplate(area: HTMLElement, s: TemplateState, n: Needs) {
  const notice = Object.assign(area.ownerDocument.createElement('div'), { className: 'dock-notice', role: 'status' });
  const state = (): TemplateState => ({ ...s, order: view.states() });
  const changed = () => {
    s = state(); n.remember(s);
    const count = s.parked.length;
    notice.hidden = !count || dismissed.get(area) === count;
    notice.firstChild!.textContent = `${count} panel${count === 1 ? '' : 's'} hidden — `;
  };
  /** Fills position `i` with `p` (out of the parked panels, if it was one). */
  const fill = (i: number, p: PanelState) => {
    const at = s.parked.findIndex((q) => same(q, p));
    // ponytail: an unnamed widget matches any parked one of its kind (they are alike); the picker does not say which section
    if (at >= 0) s = { ...s, parked: s.parked.filter((_, j) => j !== at) };
    view.set(i, p); changed();
  };
  const view = renderTemplate(area, s.template, s.order, n.title, n.mount, {
    swap: () => { s = state(); n.remember(s); },
    add: (i, anchor) => void n.pick(anchor, s.parked).then((p) => { if (p) { fill(i, p); view.panel(i)?.focus(); } }),
    remove: (i) => { view.set(i, null); changed(); },
  });
  const bring = Object.assign(area.ownerDocument.createElement('button'), { type: 'button', textContent: 'Bring back' });
  bring.addEventListener('click', () => n.bringBack(bringBackTo(s.order.filter(Boolean).length + s.parked.length, s.template)));
  const close = Object.assign(area.ownerDocument.createElement('button'), { type: 'button', textContent: '✕', title: 'Dismiss' });
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', () => { dismissed.set(area, s.parked.length); notice.hidden = true; });
  notice.append(area.ownerDocument.createTextNode(''), bring, close);
  area.append(notice);
  changed();
  return {
    get state() { return state(); },
    /** A panel added from outside: the position showing it focused, else the first empty one filled; false if neither. */
    add(p: PanelState): boolean {
      const order = view.states(), shown = p.name ? order.findIndex((q) => q && same(q, p)) : -1;
      const i = shown >= 0 ? shown : order.indexOf(null);
      if (i < 0) return false;
      if (shown < 0) fill(i, p); else view.panel(i)?.focus();
      return true;
    },
    /** golden-layout, holding the kept dock, made to match: panels emptied here closed, panels added here split in. */
    backToDock(layout: GoldenLayout, add: (p: PanelState) => void) {
      const st = state(), want = [...st.order.filter((p) => p !== null), ...st.parked], tree = panelsInOrder(layout.saveLayout().root);
      const live = (i?: ContentItem): ComponentItem[] => !i ? [] : i.isComponent ? [i as ComponentItem] : i.contentItems.flatMap(live);
      const items = live(layout.rootItem), left = [...want];
      tree.forEach((p, k) => { const at = left.findIndex((q) => same(q, p)); if (at >= 0) left.splice(at, 1); else items[k]!.close(); });
      left.forEach(add);
    },
    dispose() { view.dispose(); notice.remove(); },
  };
}
