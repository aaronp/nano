/**
 * <workspace-dock>'s saved layout, in storage under the dock's `storage-key`. Panels refer to widgets by id, so a saved
 * layout holds no markup; one naming a widget the palette no longer has is ignored.
 *
 *   const r = readSaved(localStorage, 'my-app.workspace', id => defs.has(id))   // a config, null, or { ignored }
 */
import { LayoutConfig, type ResolvedLayoutConfig } from 'golden-layout/dist/esm/index.js';
import { panelIds } from '../lib/dock-layout.ts';

/** The layout saved under `key`: none when nothing is saved or storage fails, `ignored` when it names widgets not `known`. */
export function readSaved(storage: Storage, key: string, known: (id: string) => boolean): LayoutConfig | null | { ignored: string[] } {
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return null; }
  if (raw === null) return null;
  const resolved = JSON.parse(raw) as ResolvedLayoutConfig;
  const ignored = panelIds(resolved.root as never).filter((id) => !known(id));
  return ignored.length ? { ignored } : LayoutConfig.fromResolved(resolved);
}
