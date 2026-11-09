/**
 * Importing a package of components by its manifest URL: fetch and check the manifest, load its module (its shared
 * imports resolve to the host's copies through the page's import map), check its catalog, define its elements and
 * add it to the host. Nothing is added unless every step passes. Remembered imports load at start-up.
 */
import type { Catalog } from '@pritzlaff/nano-elements';
import { addCatalog, loadedNames } from './composable.ts';
import { catalogMismatch, clashes, importsStore, parseManifest, type Manifest } from './lib/imports.ts';

/** How to reach the network: the page's fetch and import(), or stand-ins in tests. */
export type ImportDeps = { fetchJson(url: string): Promise<unknown>; importModule(url: string): Promise<Record<string, unknown>> };
export const pageDeps: ImportDeps = {
  fetchJson: async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); },
  importModule: (url) => import(/* @vite-ignore */ url),
};

/** A manifest from its URL, with what it would clash with; or why not. */
export async function fetchManifest(url: string, deps: ImportDeps = pageDeps): Promise<{ manifest: Manifest; clashes: string[] } | { error: string }> {
  let json: unknown;
  try { json = await deps.fetchJson(url); } catch (e) { return { error: `Couldn't fetch ${url}: ${(e as Error).message}` }; }
  const m = parseManifest(json);
  if (typeof m === 'string') return { error: m };
  const taken = loadedNames();
  return { manifest: m, clashes: [...clashes(m, taken), ...m.components.flatMap((c) => (c.tag && !taken.tags.includes(c.tag) && customElements.get(c.tag) ? [`element <${c.tag}>`] : []))] };
}

/** Loads a package and adds it to the host, or says why not (and adds nothing). */
export async function loadPackage(url: string, deps: ImportDeps = pageDeps): Promise<{ manifest: Manifest } | { error: string }> {
  const got = await fetchManifest(url, deps);
  if ('error' in got) return got;
  const { manifest: m, clashes: taken } = got;
  if (taken.length) return { error: `${m.name} clashes with what is loaded: ${taken.join(', ')}.` };
  let mod: Record<string, unknown>;
  try { mod = await deps.importModule(new URL(m.module, url).href); } catch (e) { return { error: `Couldn't load ${m.name}'s module: ${(e as Error).message}` }; }
  const catalog = mod['catalog'] as Catalog | undefined, define = mod['define'];
  if (!catalog || typeof catalog !== 'object' || typeof define !== 'function') return { error: `${m.name}'s module doesn't export a catalog and define().` };
  const mismatch = catalogMismatch(m, catalog);
  if (mismatch) return { error: mismatch };
  try { (define as () => void)(); } catch (e) { return { error: `${m.name}'s define() failed: ${(e as Error).message}` }; }
  addCatalog(catalog, { name: m.name, url });
  return { manifest: m };
}

/** Loads the remembered imports, in order; failures are told in one `imports:failed` (the drawers list them). */
export async function bootImports(deps: ImportDeps = pageDeps) {
  const store = importsStore(localStorage), failed: { url: string; error: string }[] = [];
  for (const r of store.list()) {
    const got = await loadPackage(r.url, deps);
    if ('error' in got) failed.push({ url: r.url, error: got.error });
  }
  if (failed.length) document.dispatchEvent(new CustomEvent('imports:failed', { detail: failed }));
}

// a drawer's ✕ forgets an import (its components stay until the page reloads)
document.addEventListener('imports:remove', (e) => importsStore(localStorage).remove((e as CustomEvent<{ url: string }>).detail.url));
