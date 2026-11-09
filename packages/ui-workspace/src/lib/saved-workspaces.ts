/** Saved workspaces: a copy of the workspace on its own route, with a title and icon in the nav. Pure; the list is
 * kept in storage. Each one's layout is kept by its own dock, under its own storage key. */

/** The nav icons to choose from: 24×24 stroke paths, drawn like the nav's other icons. */
export const ICONS: Record<string, string> = {
  rocket: 'M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1zM12 15l-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2zM9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  heart: 'M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
};

/** A saved workspace: where it lives, and how the nav shows it. */
export interface SavedWorkspace { readonly path: string; readonly title: string; readonly icon: string }

const KEY = 'workspace-starter.saved-workspaces';
export const PATH = /^\/[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;

/** The saved workspaces in storage: list them, or add one (a refusal is returned as a sentence). */
export const savedWorkspaces = (storage: Pick<Storage, 'getItem' | 'setItem'>) => {
  const list = (): SavedWorkspace[] => {
    try { const v = JSON.parse(storage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  const add = (ws: SavedWorkspace, taken: readonly string[]): string | null => {
    if (!PATH.test(ws.path)) return 'The route must look like /my-workspace: lower-case letters, digits and dashes after a /.';
    if (taken.includes(ws.path) || list().some((w) => w.path === ws.path)) return `${ws.path} is already a page.`;
    if (!ws.title.trim()) return 'Give it a title for the nav.';
    if (!(ws.icon in ICONS)) return `There is no icon called ${ws.icon}.`;
    storage.setItem(KEY, JSON.stringify([...list(), { path: ws.path, title: ws.title.trim(), icon: ws.icon }]));
    return null;
  };
  return { list, add };
};
