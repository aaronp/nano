/**
 * Importing a package of components by its manifest URL: fetch and check the manifest, load its module (its shared
 * imports resolve to the host's copies through the page's import map), check its catalog, define its elements and
 * add it to the host. Nothing is added unless every step passes. Remembered imports load at start-up.
 */
import type { Catalog } from '@pritzlaff/nano-elements';
import { addCatalog, loadedNames } from './composable.ts';
import { probeFrame } from './sandbox/frames.ts';
import { checkEntry, type SerialEntry } from './sandbox/protocol.ts';
import { standIn } from './sandbox/stand-in.ts';
import { setImportFailures } from './lib/import-failures.ts';
import { catalogMismatch, clashes, importsStore, parseManifest, type Manifest } from './lib/imports.ts';

/** How to reach the network: the page's fetch and import(), or stand-ins in tests. */
export type ImportDeps = { fetchJson(url: string): Promise<unknown>; importModule(url: string): Promise<Record<string, unknown>>; probe(url: string): Promise<Record<string, SerialEntry> | { error: string }> };
export const pageDeps: ImportDeps = {
  fetchJson: async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); },
  importModule: (url) => import(/* @vite-ignore */ url),
  probe: (url) => probeFrame(url),
};

/** A manifest from its URL, with what it would clash with; or why not. */
export async function fetchManifest(url: string, deps: ImportDeps = pageDeps): Promise<{ manifest: Manifest; clashes: string[] } | { error: string }> {
  let json: unknown;
  try { json = await deps.fetchJson(url); } catch (e) { return { error: `Couldn't fetch ${url}: ${(e as Error).message}` }; }
  const m = parseManifest(json);
  if (typeof m === 'string') return { error: m };
  return { manifest: m, clashes: clashesNow(m) };
}

/** What the manifest would clash with among what is loaded right now (read again just before adding: an import in flight may have added it). */
function clashesNow(m: Manifest): string[] {
  const taken = loadedNames();
  return [...clashes(m, taken), ...m.components.flatMap((c) => (c.tag && !taken.tags.includes(c.tag) && customElements.get(c.tag) ? [`element <${c.tag}>`] : []))];
}

/** Loads a package and adds it to the host, or says why not (and adds nothing). */
export async function loadPackage(url: string, deps: ImportDeps = pageDeps, trust: 'trusted' | 'sandboxed' = 'sandboxed'): Promise<{ manifest: Manifest } | { error: string }> {
  const got = await fetchManifest(url, deps);
  if ('error' in got) return got;
  const { manifest: m, clashes: taken } = got;
  if (taken.length) return { error: `${m.name} clashes with what is loaded: ${taken.join(', ')}.` };
  const module = new URL(m.module, url).href;
  if (trust !== 'trusted') {   // anything but an explicit 'trusted' is sandboxed; the host never imports this module: its catalog comes from an isolated probe
    const probed = await deps.probe(module);
    if ('error' in probed) return { error: `Couldn't probe ${m.name}: ${probed.error}` };
    const entries: Catalog = {};
    for (const [kind, raw] of Object.entries(probed)) {
      const e = checkEntry(raw);
      if (typeof e === 'string') return { error: `${m.name}'s ${kind}: ${e}` };
      entries[kind] = { component: standIn(e, () => { throw new Error(`${kind} is sandboxed: deploy it as isolated-sandbox`); }), title: e.title, ...(e.tag && { tag: e.tag }) };
    }
    const mismatch = catalogMismatch(m, entries);
    if (mismatch) return { error: mismatch };
    const late = clashesNow(m);
    if (late.length) return { error: `${m.name} clashes with what is loaded: ${late.join(', ')}.` };
    addCatalog(entries, { name: m.name, url, module }, 'sandboxed');
    return { manifest: m };
  }
  let mod: Record<string, unknown>;
  try { mod = await deps.importModule(module); } catch (e) { return { error: `Couldn't load ${m.name}'s module: ${(e as Error).message}` }; }
  const catalog = mod['catalog'] as Catalog | undefined, define = mod['define'];
  if (!catalog || typeof catalog !== 'object' || typeof define !== 'function') return { error: `${m.name}'s module doesn't export a catalog and define().` };
  const mismatch = catalogMismatch(m, catalog);
  if (mismatch) return { error: mismatch };
  const late = clashesNow(m);   // synchronously before define(): another import may have added the same kind while this one loaded
  if (late.length) return { error: `${m.name} clashes with what is loaded: ${late.join(', ')}.` };
  try { (define as () => void)(); } catch (e) { return { error: `${m.name}'s define() failed: ${(e as Error).message}` }; }
  addCatalog(catalog, { name: m.name, url, module });
  return { manifest: m };
}

/** Loads the remembered imports, in order; failures are recorded for the drawers (built later) to list. */
export async function bootImports(deps: ImportDeps = pageDeps) {
  const store = importsStore(localStorage), failed: { url: string; error: string }[] = [];
  for (const r of store.list()) {
    const got = await loadPackage(r.url, deps, r.trust ?? 'trusted');
    if ('error' in got) failed.push({ url: r.url, error: got.error });
  }
  setImportFailures(failed);
}

// a drawer's ✕ forgets an import (its components stay until the page reloads)
document.addEventListener('imports:remove', (e) => importsStore(localStorage).remove((e as CustomEvent<{ url: string }>).detail.url));
