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
  home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  window: 'M3 5h18v14H3zM3 9h18M6 7h.01M9 7h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-5-6.7',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6',
  code: 'M8 3H7a2 2 0 0 0-2 2v4l-2 3 2 3v4a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v4l2 3-2 3v4a2 2 0 0 1-2 2h-1',
  terminal: 'M4 17l6-5-6-5M12 19h8',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  server: 'M3 4h18v7H3zM3 13h18v7H3zM7 7.5h.01M7 16.5h.01',
  cloud: 'M7 19a5 5 0 0 1-.9-9.9A6 6 0 0 1 17.7 8 4.5 4.5 0 0 1 17.5 19z',
  lambda: 'M6 20l6-10M8 4h2l8 16h2',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  cpu: 'M7 7h10v10H7zM10 10h4v4h-4zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3',
  key: 'M7.5 12a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.7 13.3 21 3M17 7l3 3M15 9l2 2',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  phone: 'M7 2h10v20H7zM11 18h2',
  tablet: 'M5 2h14v20H5zM11 18h2',
  laptop: 'M4 5h16v11H4zM2 20h20',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  building: 'M4 21V3h11v18M15 9h5v12M2 21h20M8 7h3M8 11h3M8 15h3',
  store: 'M3 9l2-5h14l2 5zM3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v9h14v-9M10 21v-5h4v5',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  mail: 'M3 5h18v14H3zM3 7l9 6 9-6',
  chat: 'M21 12a8 8 0 0 1-12 7l-6 2 2-5.5A8 8 0 1 1 21 12z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  card: 'M2 6h20v12H2zM2 10h20M6 15h4',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12v4M16 13h.01',
  dollar: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  cart: 'M3 3h2l3 12h11l2-8H6M9 20a1 1 0 1 0 0 .01M18 20a1 1 0 1 0 0 .01',
  briefcase: 'M3 7h18v13H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18',
  calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 3',
  timer: 'M12 8a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 11v4l2 2M10 2h4M19 5l-2 2',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  sparkle: 'M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3',
  book: 'M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a2 2 0 0 0-2 2 2 2 0 0 0-2-2H4zM12 5v16',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  tag: 'M2 12V3h9l10 10-9 9zM7 7h.01',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  layers: 'M12 2l10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  image: 'M3 4h18v16H3zM8.5 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM21 15l-5-5L5 20',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3zM12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01',
  pin: 'M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM16 8l-2 6-6 2 2-6z',
  car: 'M5 17h14v-5l-2-5H7l-2 5zM5 12h14M7 17v2M17 17v2M7.5 14.5h.01M16.5 14.5h.01',
  train: 'M6 3h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM4 11h16M12 3v8M8 21l2-4M16 21l-2-4',
  plane: 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z',
  flask: 'M9 3h6M10 3v6L4 19a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10',
  leaf: 'M11 20A7 7 0 0 1 4 13c0-6 6-9 16-10-1 10-4 16-10 16zM4 21c3-6 7-9 12-11',
  coffee: 'M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 9h1a3 3 0 0 1 0 6h-1M8 2v3M12 2v3',
  gift: 'M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8S10 3 7.5 4 9 8 12 8zM12 8s2-5 4.5-4S15 8 12 8z',
};

/** A saved workspace: where it lives, how the nav shows it, and the system (registry) its components run in. */
export interface SavedWorkspace { readonly path: string; readonly title: string; readonly icon: string; readonly system?: string }
/** A system's name, as a registry id. */
export const SYSTEM = /^[a-z0-9][a-z0-9-]*$/;

export const KEY = 'workspace-starter.saved-workspaces';
export const PATH = /^\/[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;

/** The saved workspaces in storage: list them, check one, or add one (a refusal is returned as a sentence). */
export const savedWorkspaces = (storage: Pick<Storage, 'getItem' | 'setItem'>) => {
  const list = (): SavedWorkspace[] => {
    try { const v = JSON.parse(storage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  const refusal = (ws: SavedWorkspace, taken: readonly string[]): string | null => {
    if (!PATH.test(ws.path)) return 'The route must look like /my-workspace: lower-case letters, digits and dashes after a /.';
    if (taken.includes(ws.path) || list().some((w) => w.path === ws.path)) return `${ws.path} is already a page.`;
    if (!ws.title.trim()) return 'Give it a title for the nav.';
    if (!(ws.icon in ICONS)) return `There is no icon called ${ws.icon}.`;
    const system = ws.system ?? 'host';
    if (!SYSTEM.test(system)) return 'A system name is lower-case letters, digits and dashes.';
    return null;
  };
  const add = (ws: SavedWorkspace, taken: readonly string[]): string | null => {
    const refused = refusal(ws, taken);
    if (refused) return refused;
    storage.setItem(KEY, JSON.stringify([...list(), { path: ws.path, title: ws.title.trim(), icon: ws.icon, system: ws.system ?? 'host' }]));
    return null;
  };
  /** Moves one up (-1) or down (+1) in the stored order; false at an end or if unknown. */
  const move = (path: string, by: -1 | 1): boolean => {
    const xs = list(), i = xs.findIndex((w) => w.path === path), j = i + by;
    if (i < 0 || j < 0 || j >= xs.length) return false;
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
    storage.setItem(KEY, JSON.stringify(xs));
    return true;
  };
  /** Moves one to a place in the order: one splice, one write; false if unchanged or unknown. */
  const moveTo = (path: string, index: number): boolean => {
    const xs = list(), i = xs.findIndex((w) => w.path === path);
    if (i < 0 || index < 0 || index >= xs.length || index === i) return false;
    xs.splice(index, 0, ...xs.splice(i, 1));
    storage.setItem(KEY, JSON.stringify(xs));
    return true;
  };
  return { list, refusal, add, move, moveTo };
};
