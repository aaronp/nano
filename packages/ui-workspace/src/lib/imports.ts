/** Importing a package of components by its manifest URL: the pure parts. The manifest is version 1, as the template
 * builds it; the module's own `catalog` is the authority once loaded. */
import type { Catalog } from '@pritzlaff/nano-elements';

/** A package's manifest (version 1). `module` is relative to the manifest's URL. */
export interface Manifest {
  manifest: 1; name: string; version: string; module: string; shared?: Record<string, string>;
  components: { kind: string; id: string; title: string; tag?: string; ops?: { name: string; input: boolean; output: boolean }[] }[];
}

const str = (v: unknown) => typeof v === 'string' && v.length > 0;
/** A kind is a dock widget id; a tag a custom element name. (A bad kind would break a dock's palette.) */
const KIND = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, TAG = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

/** The manifest, checked; or why it isn't one. */
export function parseManifest(json: unknown): Manifest | string {
  const m = json as Partial<Manifest> | null;
  if (!m || typeof m !== 'object') return 'That is not a manifest (expected a JSON object).';
  if (m.manifest !== 1) return 'This host reads manifest version 1.';
  if (!str(m.name) || !str(m.version)) return 'The manifest needs a name and a version.';
  if (!str(m.module)) return 'The manifest needs a module (the path of its module).';
  if (!Array.isArray(m.components) || !m.components.length) return 'The manifest lists no components.';
  const bad = m.components.find((c) => !c || !str(c.kind) || !str(c.id) || !str(c.title) || (c.tag !== undefined && !str(c.tag)));
  if (bad) return `A component in the manifest needs a kind, an id and a title (${JSON.stringify(bad)}).`;
  const kind = m.components.find((c) => !KIND.test(c.kind));
  if (kind) return `A component's kind must be lower-case words joined by dashes (like my-thing), not ${JSON.stringify(kind.kind)}.`;
  const tag = m.components.find((c) => c.tag !== undefined && !TAG.test(c.tag));
  if (tag) return `A component's element must be a custom element name (like my-thing), not ${JSON.stringify(tag.tag)}.`;
  return m as Manifest;
}

const parts = (v: string) => v.split('-')[0]!.split('.').map((n) => Number(n));
const cmp = (a: number[], b: number[]) => { for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0); return 0; };

/** Whether a version is in a range: `^x.y.z`, `~x.y.z`, `>=x.y.z`, `*`, or an exact version. */
export function satisfies(version: string, range: string): boolean {
  const r = range.trim(), v = parts(version);
  if (r === '*' || r === '') return true;
  if (r.startsWith('>=')) return cmp(v, parts(r.slice(2))) >= 0;
  const lo = parts(r.replace(/^[\^~]/, ''));
  if (cmp(v, lo) < 0) return false;
  if (r.startsWith('~')) return v[0] === lo[0] && v[1] === lo[1];
  if (r.startsWith('^')) return lo[0]! > 0 ? v[0] === lo[0] : lo[1]! > 0 ? v[0] === 0 && v[1] === lo[1] : cmp(v, lo) === 0;
  return cmp(v, lo) === 0;
}

/** Each shared library the package expects, what the host provides, and whether that fits. */
export const sharedReport = (m: Manifest, provided: Record<string, string>) =>
  Object.entries(m.shared ?? {}).map(([specifier, range]) => ({ specifier, range, provided: provided[specifier], ok: !!provided[specifier] && satisfies(provided[specifier]!, range) }));

/** What the package would clash with among what is loaded: kinds, component ids, element tags. */
export function clashes(m: Manifest, loaded: { kinds: string[]; ids: string[]; tags: string[] }): string[] {
  return m.components.flatMap((c) => [
    ...(loaded.kinds.includes(c.kind) ? [`kind ${c.kind}`] : []),
    ...(loaded.ids.includes(c.id) ? [`component ${c.id}`] : []),
    ...(c.tag && loaded.tags.includes(c.tag) ? [`element <${c.tag}>`] : []),
  ]);
}

/** Why a loaded module's catalog doesn't match its manifest, or null if it does. */
export function catalogMismatch(m: Manifest, catalog: Catalog): string | null {
  for (const c of m.components) {
    const e = Object.hasOwn(catalog, c.kind) ? catalog[c.kind] : undefined;
    if (!e) return `The module has no ${c.kind}, which its manifest lists.`;
    if ((e.tag ?? undefined) !== (c.tag ?? undefined)) return `The module's ${c.kind} has element ${e.tag ?? 'none'}, but its manifest says ${c.tag ?? 'none'}.`;
    const eid = e.component.id, id = `${eid.ns}/${eid.name}`;
    if (id !== c.id) return `The module's ${c.kind} is ${id}, but its manifest says ${c.id}.`;
  }
  const extra = Object.keys(catalog).filter((k) => !m.components.some((c) => c.kind === k));
  return extra.length ? `The module has ${extra.join(', ')}, which its manifest doesn't list.` : null;
}

/** A remembered import. */
export interface ImportRecord { url: string; name: string; version: string; trust?: 'trusted' | 'sandboxed' }
const KEY = 'workspace-starter.imports';

/** The imports kept in storage: one record per manifest URL. */
export function importsStore(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const list = (): ImportRecord[] => { try { const v = JSON.parse(storage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const save = (xs: ImportRecord[]) => storage.setItem(KEY, JSON.stringify(xs));
  return {
    list,
    put: (r: ImportRecord) => { const xs = list(), i = xs.findIndex((x) => x.url === r.url); if (i < 0) xs.push(r); else xs[i] = r; save(xs); },
    remove: (url: string) => save(list().filter((x) => x.url !== url)),
  };
}
