/**
 * The nav's moves (ADR-0040), each one `applyPages` of a `move` (lib/pages.ts), announced in a live region. A row's
 * handle, focused: Alt+↑/↓ moves its page among its siblings, Alt+→ makes it the last child of the sibling above,
 * Alt+← moves it out to follow its parent; a refused move says so ("Lab can't move up"). Dragged: dropped on a row's middle it is that page's last child, near its
 * top or bottom edge before or after it, at its level; never into its own subtree, nor before Main (Main has no handle).
 * `reveal` opens the parents of where it went; the Outline's change reorders the nav.
 */
import type { Outline } from '@pritzlaff/nano-outline';
import { applyPages, childrenOf, move, parentOf, subtree } from '../lib/pages.ts';

type Zone = 'before' | 'inside' | 'after';
const titleOf = (d: Outline, id: string) => d.pages[id]?.title ?? id;
const WAY: Record<string, string> = { ArrowUp: 'up', ArrowDown: 'down', ArrowRight: 'in', ArrowLeft: 'out' };

/** Where key `key` takes page `id`: the next document (undefined if refused) and what is said. */
function byKey(d: Outline, id: string, key: string): [Outline | undefined, string] | undefined {
  const parent = parentOf(d, id), list = childrenOf(d, parent), i = list.indexOf(id), t = titleOf(d, id), above = list[i - 1];
  if (key === 'ArrowUp' || key === 'ArrowDown') return [move(d, id, parent, i + (key === 'ArrowUp' ? -1 : 1)), `Moved ${t} ${key === 'ArrowUp' ? 'up' : 'down'}`];
  if (key === 'ArrowRight' && above !== undefined) return [move(d, id, above, childrenOf(d, above).length), `Moved ${t} into ${titleOf(d, above)}`];
  if (key === 'ArrowLeft' && parent !== undefined) {
    const up = parentOf(d, parent);
    return [move(d, id, up, childrenOf(d, up).indexOf(parent) + 1), `Moved ${t} out of ${titleOf(d, parent)}`];
  }
  return undefined;
}

/** Page `id` dropped at `zone` of page `at`'s row; undefined if refused (its own subtree, Main's place). After a parent
 * shown open is where its first child shows, so the page goes there. */
function byDrop(d: Outline, id: string, at: string, zone: Zone, open: boolean): Outline | undefined {
  if (subtree(d, id).includes(at)) return undefined;
  if (zone === 'after' && open && childrenOf(d, at).length) return move(d, id, at, 0);
  if (zone === 'inside') return move(d, id, at, childrenOf(d, at).filter((x) => x !== id).length);
  const parent = parentOf(d, at);
  return move(d, id, parent, childrenOf(d, parent).filter((x) => x !== id).indexOf(at) + (zone === 'after' ? 1 : 0));
}

/** Whether page `at`'s row shows its children (its toggle open). */
const openRow = (row: HTMLElement) => row.querySelector(':scope > [data-toggle]')?.getAttribute('aria-expanded') === 'true';
const zoneOf = (e: MouseEvent, row: HTMLElement): Zone => {
  const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / (r.height || 1);
  return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
};

export function navMoves(doc: Document, outline: ReturnType<typeof Outline.create>, reveal: (id: string) => void) {
  const live = doc.createElement('div');
  live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
  doc.body.append(live);
  const say = (said: string) => {
    live.textContent = '';   // cleared first so a repeat is announced again
    setTimeout(() => { live.textContent = said; }, 50);
  };
  const apply = (id: string, next: Outline | undefined, said: string) => {
    if (!next || !applyPages(outline, next).ok) return false;
    reveal(id); say(said);
    return true;
  };
  const rowOf = (t: EventTarget | null) => (t as Element | null)?.closest?.<HTMLElement>('[data-saved]') ?? null;

  doc.addEventListener('keydown', (e) => {
    const handle = (e.target as Element | null)?.closest?.<HTMLElement>('[data-handle]'), id = rowOf(handle ?? null)?.dataset.saved;
    if (!handle || id === undefined || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !e.key.startsWith('Arrow')) return;
    e.preventDefault();
    const d = outline.document().doc, to = byKey(d, id, e.key);
    if (to && apply(id, ...to)) handle.focus();
    else if (WAY[e.key]) say(`${titleOf(d, id)} can't move ${WAY[e.key]}`);
  });

  let dragged: string | undefined;
  const clear = () => { for (const x of doc.querySelectorAll('[data-drop]')) x.removeAttribute('data-drop'); };
  doc.addEventListener('dragstart', (e) => {
    const row = rowOf((e.target as Element | null)?.closest?.('[data-handle]') ?? null);
    if (!row) return;
    dragged = row.dataset.saved!;
    e.dataTransfer?.setData('text/plain', dragged);
    e.dataTransfer?.setDragImage(row, 0, 0);
  });
  doc.addEventListener('dragover', (e) => {
    const row = rowOf(e.target);
    if (dragged === undefined || !row) return;
    clear();
    const zone = zoneOf(e, row);
    if (!byDrop(outline.document().doc, dragged, row.dataset.saved!, zone, openRow(row))) return;   // not a drop target: the browser shows "no drop"
    e.preventDefault();
    row.dataset.drop = zone;
  });
  doc.addEventListener('drop', (e) => {
    const row = rowOf(e.target);
    if (dragged === undefined || !row) return;
    e.preventDefault();   // dropping on a link must not navigate
    const d = outline.document().doc, at = row.dataset.saved!, zone = zoneOf(e, row);
    apply(dragged, byDrop(d, dragged, at, zone, openRow(row)), `Moved ${titleOf(d, dragged)} ${zone === 'inside' ? 'into' : zone} ${titleOf(d, at)}`);
    dragged = undefined; clear();
  });
  doc.addEventListener('dragend', () => { dragged = undefined; clear(); });
}
