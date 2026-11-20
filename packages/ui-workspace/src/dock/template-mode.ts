/**
 * <workspace-dock>'s template mode: a `TemplateState` shown by template-view.ts, kept as it changes. An empty position's
 * `+` opens the picker (parked panels listed first) and fills it; ✕ empties one; while panels are parked a notice above
 * the layout says how many, with Bring back (and ✕, which hides it until the count changes). An add from outside with
 * no room while a new pod is being made waits for it to be named.
 *
 *   const mode = showTemplate(area, state, { title, mount, pick, remember, bringBack, unnamed, say, add })
 *   mode.state; mode.add(panel); mode.backToDock(state, layout, panel => split(…)); mode.dispose(true)
 */
import type { ComponentItem, ContentItem, GoldenLayout } from 'golden-layout/dist/esm/index.js';
import { bringBackTo, type PanelState, type TemplateId, type TemplateState } from '../lib/layout-templates.ts';
import { renderTemplate } from './template-view.ts';

type Needs = {
  title(p: PanelState): string;
  mount(el: HTMLElement, p: PanelState, item: ComponentItem): void;
  pick(anchor: HTMLElement, hidden: PanelState[]): Promise<PanelState | null>;
  /** Stores the state as it now is (and tells whoever listens). */
  remember(s: TemplateState): void;
  bringBack(to: TemplateId): void;
  /** Whether `p` is an implementation's panel whose pod is still being made. */
  unnamed(p: PanelState): boolean;
  say(message: string): void;
  /** Adds `p` as from outside (a deferred add, once the new pod is named). */
  add(p: PanelState): void;
};

const same = (a: PanelState, b: PanelState) => a.widget === b.widget && a.name === b.name;
/** The parked count whose notice was dismissed, per dock area: hidden until the count changes. */
const dismissed = new WeakMap<HTMLElement, number>();

export function showTemplate(area: HTMLElement, s: TemplateState, n: Needs) {
  const notice = Object.assign(area.ownerDocument.createElement('div'), { className: 'dock-notice', role: 'status' });
  const state = (): TemplateState => ({ ...s, order: view.states() });
  const making = () => state().order.some((p) => p && n.unnamed(p)), waiting: PanelState[] = [];
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
    named: () => { changed(); if (!making()) for (const p of waiting.splice(0)) n.add(p); },
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
    /** A panel added from outside: the position showing it, else the first empty one filled, focused; with neither, it
     * waits while a new pod is being made (and says so); else false. */
    add(p: PanelState): boolean {
      const order = view.states(), shown = p.name ? order.findIndex((q) => q && same(q, p)) : -1;
      const i = shown >= 0 ? shown : order.indexOf(null);
      if (i < 0 && !making()) return false;
      if (i < 0) { waiting.push(p); n.say(`Adding ${n.title(p)} once the new pod is made.`); return true; }
      if (shown < 0) fill(i, p);
      view.panel(i)?.focus();
      return true;
    },
    /** golden-layout, holding the kept dock, made to match `st` (this template's state as it was left): panels emptied
     * here closed, panels added here split in. */
    backToDock(st: TemplateState, layout: GoldenLayout, add: (p: PanelState) => void) {
      const live = (i?: ContentItem): ComponentItem[] => !i ? [] : i.isComponent ? [i as ComponentItem] : i.contentItems.flatMap(live);
      const left = [...st.order.filter((p) => p !== null), ...st.parked];
      for (const item of live(layout.rootItem)) {
        const at = left.findIndex((q) => same(q, (item.container.stateRequestEvent?.() ?? item.container.initialState) as PanelState));
        if (at >= 0) left.splice(at, 1); else item.close();
      }
      left.forEach(add);
    },
    /** Removes it; `leaving` (back to the dock) also forgets a dismissed notice, so the next parking shows it. */
    dispose(leaving = false) { view.dispose(); notice.remove(); if (leaving) dismissed.delete(area); },
  };
}
