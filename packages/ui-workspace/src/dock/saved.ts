/**
 * <workspace-dock>'s saved layout, in storage under the dock's `storage-key`. Panels refer to widgets by id, so a saved
 * layout holds no markup; one naming a widget the palette no longer has is ignored.
 *
 *   const config = readSaved(localStorage, 'my-app.workspace', id => defs.has(id), say)   // or null
 *   const failed = writeSaved(localStorage, 'my-app.workspace', resolved)   // why it could not, if it could not
 */
import { LayoutConfig, type ResolvedLayoutConfig } from 'golden-layout/dist/esm/index.js';
import { panelIds } from '../lib/dock-layout.ts';

/** The layout saved under `key`: none when nothing is saved or storage fails, or when it names widgets not `known` (`say` why). */
export function readSaved(storage: Storage, key: string, known: (id: string) => boolean, say: (message: string) => void): LayoutConfig | null {
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return null; }
  if (raw === null) return null;
  const resolved = JSON.parse(raw) as ResolvedLayoutConfig;
  const ignored = panelIds(resolved.root as never).filter((id) => !known(id));
  if (!ignored.length) return LayoutConfig.fromResolved(resolved);
  say(`Saved layout ignored: it uses widgets that no longer exist (${ignored.join(', ')}).`);
  return null;
}

/** Saves `resolved` under `key`; why it could not, if storage failed. */
export function writeSaved(storage: Storage, key: string, resolved: ResolvedLayoutConfig): string | undefined {
  try { storage.setItem(key, JSON.stringify(resolved)); } catch (err) { return `Could not save the layout: ${(err as Error).message}`; }
  return undefined;
}
