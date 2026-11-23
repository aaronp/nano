/**
 * Under `<meta name="nano-app-file" content="/nano.json">` (the page the nano-app CLI serves): the app boots in memory from
 * that file, File › Save PUTs the document back to it (`saveTo`, with the file's own `modules` put back: `restoreModules`),
 * and a rebuild of the project reloads the page, or asks first when the File menu has unsaved changes (`onRebuild`).
 */
import { toast } from '@pritzlaff/nano-elements';
import { failure, success, type NanoResult } from '@pritzlaff/nano-core';

/** The meta's content: the path of the opened file, if the CLI served this page. */
export const devFile = (doc: Document): string | undefined => doc.querySelector<HTMLMetaElement>('meta[name="nano-app-file"]')?.content || undefined;

type Obj = Record<string, unknown>;
const modulesOf = (o: Obj): Obj => ({ ...(o['modules'] as Obj | undefined), ...((o['app'] as Obj | undefined)?.['modules'] as Obj | undefined) });
/** `saved` with each `modules` key the original file had (top level or under `app`) given the original's value (the import resolved them to URLs). */
export function restoreModules(saved: object, original: object): object {
  const had = modulesOf(original as Obj), out = { ...saved } as Obj;
  const put = (m: unknown) => m && typeof m === 'object' ? Object.fromEntries(Object.entries(m as Obj).map(([k, v]) => [k, k in had ? had[k] : v])) : m;
  if (out['modules']) out['modules'] = put(out['modules']);
  const app = out['app'] as Obj | undefined;
  if (app?.['modules']) out['app'] = { ...app, modules: put(app['modules']) };
  return out;
}

/** PUT `body` (2-space JSON, a trailing newline) to `path`; a non-2xx is a failure with the status text. */
export async function saveTo(path: string, body: object, fetchFn: typeof fetch = fetch): Promise<NanoResult<void>> {
  try {
    const r = await fetchFn(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body, null, 2) + '\n' });
    return r.ok ? success(undefined) : failure('denied', `not saved: ${r.status} ${r.statusText}`.trim());
  } catch (e) { return failure('threw', `not saved: ${e instanceof Error ? e.message : String(e)}`); }
}

type Source = { addEventListener(type: 'message', fn: (e: { data: string }) => void): void };
/** Reload on the CLI's `rebuilt` (the notice instead when `dirty()`); `build-failed <text>` is shown as a toast. */
export function onRebuild(doc: Document, dirty: () => boolean, reload: () => void = () => location.reload(), source: Source = new EventSource('/__nano-app/events')): void {
  source.addEventListener('message', ({ data }) => {
    const text = String(data);
    if (text.startsWith('build-failed')) return void toast(text.slice('build-failed'.length).trim(), { variant: 'bad' });
    if (text !== 'rebuilt') return;
    if (!dirty()) return reload();
    if (doc.querySelector('[data-rebuilt]')) return;
    const note = doc.createElement('div');
    note.setAttribute('role', 'status'); note.dataset['rebuilt'] = '';
    note.append('Rebuilt — Reload (unsaved changes are lost)');
    for (const [label, run] of [['Reload', reload], ['Later', () => note.remove()]] as const) {
      const b = doc.createElement('button'); b.textContent = label; b.addEventListener('click', () => run()); note.append(b);
    }
    doc.body.append(note);
  });
}
