/**
 * The picker's content, in both its forms (picker.ts's popover; inline, filling an empty position or dock): a filter,
 * `Runtime:` pills (where a provider tile's pod is placed; the session's last choice, else main), then Hidden (parked
 * panels, when given), one group of tiles per provider (nano.ui, then each import with ✕ remove), failed imports, and
 * Views (no pod, so the pills are disabled there). Arrows move between tiles, Enter picks. Light DOM.
 */
import { importFailures } from '../lib/import-failures.ts';
import type { PanelState } from '../lib/layout-templates.ts';

type Entries = { templates: HTMLTemplateElement[]; hidden?: PanelState[]; runtimes: string[] };
let last: string | undefined;   // the runtime chosen this session (not persisted)

/** Fills `host` with the grid; resolves with the chosen tile (and the runtime, for a provider's), never null: closing is the popover's. */
export function pickerGrid(host: HTMLElement, { templates, hidden, runtimes }: Entries): Promise<{ state: PanelState; runtime?: string } | null> {
  const doc = host.ownerDocument, body = Object.assign(doc.createElement('div'), { className: 'np-body' });
  body.setAttribute('role', 'group'); body.setAttribute('aria-label', 'Add a panel');
  let runtime = last !== undefined && runtimes.includes(last) ? last : runtimes.includes('main') ? 'main' : runtimes[0]!;
  const filter = Object.assign(doc.createElement('input'), { type: 'search', className: 'np-filter', placeholder: 'Filter' });
  filter.setAttribute('aria-label', 'Filter components');
  const bar = Object.assign(doc.createElement('div'), { className: 'np-runtimes' }), list = doc.createElement('div');
  bar.setAttribute('role', 'radiogroup'); bar.setAttribute('aria-label', 'Runtime');
  const mark = () => { for (const b of bar.querySelectorAll<HTMLElement>('[data-runtime]')) { const on = b.dataset['runtime'] === runtime; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; } };
  bar.append(Object.assign(doc.createElement('span'), { textContent: 'Runtime:' }), ...runtimes.map((r) => {
    const b = Object.assign(doc.createElement('button'), { type: 'button', textContent: r });
    b.dataset['runtime'] = r; b.setAttribute('role', 'radio');
    b.addEventListener('click', () => { runtime = last = r; mark(); });
    return b;
  }));
  bar.addEventListener('keydown', (e) => {   // the radio pattern: arrows choose the neighbour
    const bs = [...bar.querySelectorAll<HTMLButtonElement>('[data-runtime]')].filter((b) => !b.disabled), d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const to = d && bs[bs.findIndex((b) => b.dataset['runtime'] === runtime) + d];
    if (!to) return;
    e.preventDefault(); runtime = last = to.dataset['runtime']!; mark(); to.focus();
  });
  mark();
  body.append(filter, bar, list);

  const section = (id: string, kind: string, title: string) => {
    const s = Object.assign(doc.createElement('section'), { className: 'np-section' });
    s.dataset['section'] = id; s.dataset['kind'] = kind;
    s.append(Object.assign(doc.createElement('h3'), { textContent: title }));
    return s;
  };
  const tile = (widget: string, label: string, name?: string) => {
    const b = Object.assign(doc.createElement('button'), { type: 'button', textContent: label });
    b.dataset['widget'] = widget;
    if (name !== undefined) b.dataset['name'] = name;
    return b;
  };
  const ofTemplate = (t: HTMLTemplateElement) => tile(t.dataset['widget']!, t.dataset['title'] ?? t.dataset['widget']!);
  const title = (widget: string) => templates.find((t) => t.dataset['widget'] === widget)?.dataset['title'] ?? widget;

  const applyFilter = () => {
    const q = filter.value.trim().toLowerCase();
    for (const b of list.querySelectorAll<HTMLElement>('[data-widget]')) b.hidden = !b.textContent!.toLowerCase().includes(q);
    for (const s of list.querySelectorAll<HTMLElement>('.np-section')) s.hidden = !!s.querySelector('[data-widget]') && ![...s.querySelectorAll<HTMLElement>('[data-widget]')].some((b) => !b.hidden);
  };
  /** (Re)builds the groups from the templates still in the page, and the failed imports. */
  const build = () => {
    const ts = templates.filter((t) => t.isConnected), sections: HTMLElement[] = [], groups = new Map<string, HTMLTemplateElement[]>(), views: HTMLTemplateElement[] = [];
    if (hidden?.length) {
      const s = section('hidden', 'hidden', 'Hidden');
      s.append(...hidden.map((h) => tile(h.widget, h.name ?? title(h.widget), h.name)));
      sections.push(s);
    }
    for (const t of ts) {
      const g = t.dataset['package'] ?? (t.hasAttribute('data-catalog') ? 'nano.ui' : undefined);
      if (g) groups.set(g, [...(groups.get(g) ?? []), t]); else views.push(t);
    }
    for (const [name, pts] of [...groups].sort(([a], [b]) => +(b === 'nano.ui') - +(a === 'nano.ui'))) {
      const s = section(name, 'provider', name);
      if (name !== 'nano.ui') {
        const x = Object.assign(doc.createElement('button'), { type: 'button', textContent: '✕', title: `Forget ${name} (its components stay until you reload)` });
        x.setAttribute('aria-label', `Remove ${name}`);
        x.addEventListener('click', () => doc.dispatchEvent(new CustomEvent('imports:remove', { detail: { url: pts[0]!.dataset['packageUrl'], name } })));
        s.firstElementChild!.append(x);
      }
      s.append(...pts.map(ofTemplate));
      sections.push(s);
    }
    const failed = section('failed', 'failed', 'Failed imports');
    for (const f of importFailures()) failed.append(Object.assign(doc.createElement('p'), { className: 'np-failed', textContent: `${f.url}: ${f.error}` }));
    if (failed.childElementCount > 1) sections.push(failed);
    if (views.length) { const s = section('views', 'views', 'Views'); s.append(...views.map(ofTemplate)); sections.push(s); }
    list.replaceChildren(...sections);
    applyFilter();
  };
  const tiles = () => [...list.querySelectorAll<HTMLElement>('[data-widget]')].filter((b) => !b.hidden && !b.closest('[hidden]'));

  return new Promise((resolve) => {
    const rebuild = () => { if (body.isConnected) build(); else off(); };   // the popover closed or the place was filled otherwise: stop listening
    const off = () => { doc.removeEventListener('catalog:changed', rebuild); doc.removeEventListener('imports:failed', rebuild); };
    body.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-widget]');
      if (!b) return;
      off();
      const state = b.dataset['name'] === undefined ? { widget: b.dataset['widget']! } : { widget: b.dataset['widget']!, name: b.dataset['name'] };
      resolve(b.closest<HTMLElement>('[data-kind]')?.dataset['kind'] === 'provider' ? { state, runtime } : { state });
    });
    body.addEventListener('keydown', (e) => {
      const ts = tiles(), at = ts.indexOf(doc.activeElement as HTMLElement), cur = ts[at];
      if (!e.key.startsWith('Arrow') || (!cur && !(e.target === filter && e.key === 'ArrowDown'))) return;
      e.preventDefault();
      const row = cur ? Math.max(1, ts.filter((b) => b.parentElement === cur.parentElement && b.offsetTop === cur.offsetTop).length) : 1;   // tiles per row
      const to = at + ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: row, ArrowUp: -row }[e.key] ?? 0);
      if (to < 0) filter.focus(); else ts[Math.min(to, ts.length - 1)]?.focus();
    });
    body.addEventListener('focusin', (e) => { const v = !!(e.target as Element).closest('[data-kind="views"]'); for (const b of bar.querySelectorAll('button')) b.disabled = v; });
    filter.addEventListener('input', applyFilter);
    doc.addEventListener('catalog:changed', rebuild); doc.addEventListener('imports:failed', rebuild);
    build();
    host.replaceChildren(body);
  });
}
