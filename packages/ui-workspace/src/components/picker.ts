/**
 * <nano-picker>: a popover, anchored at the control that opened it, for choosing what fills a place. A focused filter,
 * then Hidden (parked panels, when given), Components (the host's catalog), Widgets (the page's own) and Imported
 * (packages imported from a URL, each with ✕ remove, and imports that failed). Light DOM; `pick` makes and awaits it.
 */
import { importFailures } from '../lib/import-failures.ts';
import type { PanelState } from '../lib/layout-templates.ts';

class NanoPicker extends HTMLElement {}
if (!customElements.get('nano-picker')) customElements.define('nano-picker', NanoPicker);

type Entries = { templates: HTMLTemplateElement[]; hidden?: PanelState[] };
const WIDTH = 280;   // app.css

/** Opens the picker at `anchor`; resolves with the chosen entry, or null on Esc / a press outside. */
export function pick(anchor: HTMLElement, { templates, hidden }: Entries): Promise<PanelState | null> {
  const doc = anchor.ownerDocument, p = doc.createElement('nano-picker'), r = anchor.getBoundingClientRect();
  p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Add a component');
  p.style.left = `${Math.max(8, Math.min(r.left, innerWidth - WIDTH - 8))}px`; p.style.top = `${r.bottom + 4}px`;
  const filter = Object.assign(doc.createElement('input'), { type: 'search', className: 'np-filter', placeholder: 'Filter' });
  filter.setAttribute('aria-label', 'Filter components');
  const list = doc.createElement('div');
  p.append(filter, list);

  const section = (id: string, title: string) => {
    const s = Object.assign(doc.createElement('section'), { className: 'np-section' });
    s.dataset.section = id;
    s.append(Object.assign(doc.createElement('h3'), { textContent: title }));
    return s;
  };
  const entry = (widget: string, label: string, name?: string) => {
    const b = Object.assign(doc.createElement('button'), { type: 'button', textContent: label });
    b.dataset.widget = widget;
    if (name !== undefined) b.dataset.name = name;
    return b;
  };
  const ofTemplate = (t: HTMLTemplateElement) => entry(t.dataset.widget!, t.dataset.title ?? t.dataset.widget!);
  const title = (widget: string) => templates.find((t) => t.dataset.widget === widget)?.dataset.title ?? widget;

  const applyFilter = () => {
    const q = filter.value.trim().toLowerCase();
    for (const b of list.querySelectorAll<HTMLElement>('[data-widget]')) b.hidden = !b.textContent!.toLowerCase().includes(q);
    for (const s of list.querySelectorAll<HTMLElement>('.np-section')) s.hidden = ![...s.querySelectorAll<HTMLElement>('[data-widget]')].some((b) => !b.hidden);
  };
  /** (Re)builds the sections from the templates still in the page, and the failed imports. */
  const build = () => {
    const ts = templates.filter((t) => t.isConnected), sections: HTMLElement[] = [];
    if (hidden?.length) {
      const s = section('hidden', 'Hidden');
      s.append(...hidden.map((h) => entry(h.widget, h.name ?? title(h.widget), h.name)));
      sections.push(s);
    }
    for (const [id, label, catalog] of [['components', 'Components', true], ['widgets', 'Widgets', false]] as const) {
      const s = section(id, label);
      s.append(...ts.filter((t) => t.hasAttribute('data-catalog') === catalog && !t.dataset.package).map(ofTemplate));
      if (s.childElementCount > 1) sections.push(s);
    }
    const imported = section('imported', 'Imported'), byPackage = new Map<string, HTMLTemplateElement[]>();
    for (const t of ts) if (t.dataset.package) byPackage.set(t.dataset.package, [...(byPackage.get(t.dataset.package) ?? []), t]);
    for (const [name, pts] of byPackage) {
      const h = Object.assign(doc.createElement('h4'), { textContent: name });
      const x = Object.assign(doc.createElement('button'), { type: 'button', textContent: '✕', title: `Forget ${name} (its components stay until you reload)` });
      x.setAttribute('aria-label', `Remove ${name}`);
      x.addEventListener('click', () => doc.dispatchEvent(new CustomEvent('imports:remove', { detail: { url: pts[0]!.dataset.packageUrl, name } })));
      h.append(x);
      imported.append(h, ...pts.map(ofTemplate));
    }
    for (const f of importFailures()) imported.append(Object.assign(doc.createElement('p'), { className: 'np-failed', textContent: `${f.url}: ${f.error}` }));
    if (imported.childElementCount > 1) sections.push(imported);
    list.replaceChildren(...sections);
    applyFilter();
  };

  return new Promise((resolve) => {
    const close = (choice: PanelState | null) => {
      p.remove();
      doc.removeEventListener('pointerdown', outside, true); doc.defaultView?.removeEventListener('hashchange', gone);
      doc.removeEventListener('catalog:changed', build); doc.removeEventListener('imports:failed', build);
      resolve(choice);
    };
    const outside = (e: Event) => { if (!p.contains(e.target as Node | null)) close(null); }, gone = () => close(null);   // gone: the page changed (Back)
    p.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-widget]');
      if (b) close(b.dataset.name === undefined ? { widget: b.dataset.widget! } : { widget: b.dataset.widget!, name: b.dataset.name });
    });
    p.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      close(null);
      if (anchor.isConnected) anchor.focus();
    });
    p.addEventListener('focusout', (e) => { if (e.relatedTarget instanceof Node && !p.contains(e.relatedTarget)) close(null); });
    filter.addEventListener('input', applyFilter);
    doc.addEventListener('pointerdown', outside, true); doc.defaultView?.addEventListener('hashchange', gone);
    doc.addEventListener('catalog:changed', build); doc.addEventListener('imports:failed', build);
    build();
    doc.body.append(p);
    // no room below the anchor: above it, kept in view
    if (r.bottom + 4 + p.offsetHeight > innerHeight - 8) p.style.top = `${Math.max(8, r.top - 4 - p.offsetHeight)}px`;
    filter.focus();
  });
}
