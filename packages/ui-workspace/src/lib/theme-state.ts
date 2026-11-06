/**
 * Theme state (the impure edge: <html> attributes, CSS custom properties, localStorage, OS preference).
 *
 * The chosen theme lives on <html> (data-theme, data-mode, data-scheme and the CSS custom properties), so
 * every component and plain page CSS sees it. Pickers stay in sync through the "app-theme-change" event.
 * The choice is remembered in localStorage when the browser allows it.
 */
import { isMode, isThemeId, resolveScheme, themeVars, type Mode, type ThemeId } from './themes.ts';

export interface ThemeChoice { readonly theme: ThemeId; readonly mode: Mode }

const KEY = 'workspace-starter.theme';
export const THEME_EVENT = 'app-theme-change';
export const DEFAULT_CHOICE: ThemeChoice = { theme: 'enterprise', mode: 'system' };

/** Parse a stored choice; anything unrecognised is rejected rather than half-applied. */
export const parseChoice = (raw: string | null): ThemeChoice | null => {
  if (raw === null) return null;
  const [theme = '', mode = ''] = raw.split(':');
  return isThemeId(theme) && isMode(mode) ? { theme, mode } : null;
};

const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

/** Read the remembered choice. `remembered: false` tells the settings page storage is unavailable. */
export const loadChoice = (): { readonly choice: ThemeChoice; readonly remembered: boolean } => {
  try {
    return { choice: parseChoice(localStorage.getItem(KEY)) ?? DEFAULT_CHOICE, remembered: true };
  } catch {
    return { choice: DEFAULT_CHOICE, remembered: false };
  }
};

let storageWorks = true;
export const canRemember = () => storageWorks;

/** Apply a choice to the document and tell every picker. */
export const applyChoice = (doc: Document, choice: ThemeChoice): void => {
  const root = doc.documentElement;
  const scheme = resolveScheme(choice.theme, choice.mode, systemDark());
  for (const [k, v] of Object.entries(themeVars(choice.theme, scheme))) root.style.setProperty(k, v);
  root.dataset['theme'] = choice.theme;
  root.dataset['mode'] = choice.mode;
  root.dataset['scheme'] = scheme;
  root.style.colorScheme = scheme;
  try { localStorage.setItem(KEY, `${choice.theme}:${choice.mode}`); storageWorks = true; } catch { storageWorks = false; }
  doc.dispatchEvent(new CustomEvent<ThemeChoice>(THEME_EVENT, { detail: choice }));
};

export const currentChoice = (doc: Document): ThemeChoice => {
  const t = doc.documentElement.dataset['theme'] ?? '', m = doc.documentElement.dataset['mode'] ?? '';
  if (!isThemeId(t) || !isMode(m)) throw new Error('theme not applied yet: call applyChoice() at startup (see src/main.ts)');
  return { theme: t, mode: m };
};

/** Re-apply when the OS switches light/dark (only matters in "system" mode). */
export const followSystem = (doc: Document): void => {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyChoice(doc, currentChoice(doc)));
};

