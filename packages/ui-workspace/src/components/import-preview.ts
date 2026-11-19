/**
 * The Import dialog's preview of a fetched nano.json: its runtimes by namespace, each pod with a tick box and the
 * isolation Trust gives it, the warnings of what is left out, and the notice of providers from another origin.
 *
 *   const p = preview(file, url, 'nano.json', known); box.replaceChildren(...p.nodes); p.show('sandboxed', keep)
 */
import type { AppDeployment } from '@pritzlaff/nano-core';
import { foreignOrigin, type Foreign } from '../import.ts';
import { el } from '../import-confirm.ts';
import { isolationUnder, podsOf, selectPods, suggestedName, type Trust } from '../import-plan.ts';

type Known = (coord: string) => boolean;
const text = (s: string) => document.createTextNode(s);
const list = (title: string, items: Node[]) => (items.length ? [el('h3', title), el('ul', '', ...items)] : []);

/** The providers from another origin, in one line: where from, and (strong) each pod that would run with this page's
 * full access; the modules behind a Details (as text, never HTML). */
function origins(d: AppDeployment, base: string, trust: Trust, known: Known) {
  const foreign: Foreign[] = Object.entries(d.modules ?? {}).flatMap(([coord, m]) => {
    const url = new URL(m, base).href, origin = foreignOrigin(url);
    return origin ? [{ coord, url, origin, pods: podsOf(d, coord, p => isolationUnder(p, trust, known)) }] : [];
  });
  const notice = el('div');
  notice.className = 'foreign';
  const full = foreign.flatMap(f => f.pods.filter(p => p.fullAccess).map(p => p.name));
  if (foreign.length) notice.append(
    el('p', '', text(`Code from ${[...new Set(foreign.map(f => f.origin))].join(', ')} (${foreign.map(f => f.coord).join(', ')}). `),
      ...(full.length ? [text('⚠ With this workspace’s full access: '), ...full.flatMap((n, i) => [...(i ? [text(', ')] : []), el('strong', n)]), text('. Import is your consent.')]
        : [text('Every pod from there runs isolated.')])));
  const modules = Object.entries(d.modules ?? {}).map(([c, m]) => el('li', '', el('code', c), text(' — '), el('code', new URL(m, base).href)));
  const more = el('details', '', el('summary', 'Modules'), el('ul', '', ...modules));
  return modules.length ? [notice, more] : [notice];
}

export function preview(d: AppDeployment, url: string, name: string, known: Known) {
  const base = url.startsWith('blob:') ? location.href : url;   // a local file's modules resolve against the page
  const box = (key: string, value: string, label: string) => {
    const b = el('input'); b.type = 'checkbox'; b.checked = true; b.dataset[key] = value; b.setAttribute('aria-label', label);
    return b;
  };
  const runtime = ([id, r]: [string, AppDeployment['runtimes'][string]]) => {
    // the name it is imported as: text, with an edit button (shown on hover) that opens the field
    const input = el('input'), shown = el('code', ''), edit = el('button', '✎');
    input.value = suggestedName(d, id, known); input.dataset['runtime'] = id; input.setAttribute('aria-label', `Import runtime ${id} as`); input.hidden = true;
    shown.textContent = input.value;
    edit.type = 'button'; edit.className = 'edit'; edit.setAttribute('aria-label', `Rename runtime ${id}`);
    edit.addEventListener('click', () => { shown.hidden = true; edit.hidden = true; input.hidden = false; input.focus(); input.select(); });
    input.addEventListener('input', () => { shown.textContent = input.value; });
    const pods = el('ul', '', ...r.pods.map(p => {
      const badge = el('span'); badge.dataset['isolation'] = ''; badge.className = 'badge';
      const li = el('li', '', box('selectPod', p, `Import pod ${p}`), text(' '), el('code', p), text(' '), badge); li.dataset['pod'] = p; return li;
    }));
    const li = el('li', '', box('selectRuntime', id, `Import runtime ${id}`), text(' '), shown, input, edit, pods);
    li.dataset['runtimeOf'] = id; li.className = 'runtime';
    return li;
  };
  /** Runtimes by namespace (the id less its last segment): `example.chat` holds example.chat.room and .backend. */
  const groups = Map.groupBy(Object.entries(d.runtimes), ([id]) => id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : id);
  const runtimes = [...groups].map(([ns, rs]) => {
    const li = el('li', '', box('selectGroup', ns, `Import all of ${ns}`), text(' '), el('b', ns), el('ul', '', ...rs.map(runtime)));
    li.dataset['groupOf'] = ns; li.className = 'group';
    return li;
  });
  const pane = el('div'); pane.className = 'pods';
  const tree = el('div', '', ...list('Runtimes', runtimes));
  return { nodes: [el('p', '', el('b', name)), tree, pane],
    /** Each pod's isolation under `trust`, the warnings under their pods, and the ticked pods' origins and modules. */
    show: (trust: Trust, keep: Set<string>) => {
      const { deployment: s, warnings } = selectPods(d, keep);
      for (const li of tree.querySelectorAll<HTMLElement>('[data-pod]')) li.querySelector('[data-isolation]')!.textContent = isolationUnder(d.pods[li.dataset['pod']!]!, trust, known);
      for (const old of tree.querySelectorAll('.warning')) old.remove();
      for (const w of warnings) {   // each under the pod it concerns
        const p = el('p', `⚠ ${w.text}`); p.className = 'warning';
        tree.querySelector(`[data-pod="${CSS.escape(w.pod)}"]`)?.append(p);
      }
      pane.replaceChildren(...origins(s, base, trust, known));
    } };
}
