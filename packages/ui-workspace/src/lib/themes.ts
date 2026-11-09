/**
 * Themes are data: each one is a set of CSS custom properties. Components only read the tokens
 * (var(--bg), var(--accent)…), so adding a theme never touches component code.
 *
 * To add a theme: add an entry to THEMES with every token in TOKEN_NAMES (a test checks this).
 */

/** Every token a theme must define. Components may rely on all of these existing. */
export const TOKEN_NAMES = [
  'bg', 'surface', 'surface-2', 'fg', 'muted', 'line', 'accent', 'on-accent', 'accent-soft',
  'appbar-bg', 'appbar-fg', 'drawer-bg',
  'font', 'display', 'mono', 'radius', 'card-border', 'card-shadow', 'focus',
] as const;
export type TokenName = (typeof TOKEN_NAMES)[number];
export type Tokens = Readonly<Record<TokenName, string>>;

export type Scheme = 'light' | 'dark';
/** What the visitor picked: follow the OS ("system"), or force light or dark. */
export type Mode = 'system' | Scheme;

export interface Theme {
  /** Shown in the theme picker. */ readonly label: string;
  /** One line for the settings page. */ readonly desc: string;
  /** Token sets by scheme. A theme with only one scheme ignores the light/dark choice. */
  readonly schemes: Readonly<Partial<Record<Scheme, Tokens>>>;
  /** Google Fonts families this theme uses (for the docs; index.html loads them). */
  readonly fonts: readonly string[];
  /** Widget colours the --nano-* contract adds; unset ones come from the scheme's defaults (nano-vars.ts). */
  readonly nano?: NanoExtras;
  /** A page background image (such as grid paper), behind everything. */
  readonly background?: string;
}

/** The --nano-* tokens a theme may set beyond its page tokens. */
export type NanoExtras = Readonly<Partial<Record<'fg-2' | 'border-strong' | 'radius-s' | 'good' | 'good-bg' | 'bad' | 'bad-bg' | 'warn' | 'warn-bg'
  | 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7' | 's8', string>>>;

import { LEDGER_THEMES } from './ledger-themes.ts';

const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

export const THEMES = {
  enterprise: {
    label: 'Enterprise',
    desc: 'Navy app bar, white panels, quiet borders.',
    fonts: ['IBM Plex Sans', 'IBM Plex Mono'],
    schemes: {
      light: {
        bg: '#F2F4F7', surface: '#FFFFFF', 'surface-2': '#E9EDF2', fg: '#14212F', muted: '#566476', line: '#D5DBE3',
        accent: '#1F5AA6', 'on-accent': '#FFFFFF', 'accent-soft': '#E3ECF8',
        'appbar-bg': '#0F2A4A', 'appbar-fg': '#FFFFFF', 'drawer-bg': '#FFFFFF',
        font: SANS, display: SANS, mono: MONO, radius: '8px',
        'card-border': '1px solid #D5DBE3', 'card-shadow': '0 1px 2px rgba(20,33,47,.06)', focus: '#1F5AA6',
      },
      dark: {
        bg: '#0E141C', surface: '#151D28', 'surface-2': '#1C2633', fg: '#E3E9F1', muted: '#93A1B3', line: '#2A3644',
        accent: '#6EA8F2', 'on-accent': '#0B1622', 'accent-soft': '#1B2D45',
        'appbar-bg': '#0A1A2E', 'appbar-fg': '#E3E9F1', 'drawer-bg': '#121A24',
        font: SANS, display: SANS, mono: MONO, radius: '8px',
        'card-border': '1px solid #2A3644', 'card-shadow': 'none', focus: '#6EA8F2',
      },
    },
  },
  terminal: {
    label: 'Terminal',
    desc: 'Monospace panes, green on black.',
    fonts: ['JetBrains Mono'],
    schemes: {
      dark: {
        bg: '#0B0E0C', surface: '#101512', 'surface-2': '#151C18', fg: '#CFE3D2', muted: '#7F9A86', line: '#2A3A30',
        accent: '#7EE787', 'on-accent': '#0B0E0C', 'accent-soft': '#16301D',
        'appbar-bg': '#0B0E0C', 'appbar-fg': '#7EE787', 'drawer-bg': '#0D110F',
        font: "'JetBrains Mono', ui-monospace, monospace", display: "'JetBrains Mono', ui-monospace, monospace", mono: "'JetBrains Mono', ui-monospace, monospace",
        radius: '0px', 'card-border': '1px solid #2A3A30', 'card-shadow': 'none', focus: '#7EE787',
      },
    },
  },
  sketch: {
    label: 'Sketch',
    desc: 'Hand-drawn outlines on dotted paper.',
    fonts: ['Architects Daughter', 'Caveat'],
    schemes: {
      light: {
        bg: '#FBFAF5', surface: '#FFFFFF', 'surface-2': '#FFF3BF', fg: '#1E1E1E', muted: '#55524A', line: '#1E1E1E',
        accent: '#1971C2', 'on-accent': '#FFFFFF', 'accent-soft': '#D0EBFF',
        'appbar-bg': '#FFF3BF', 'appbar-fg': '#1E1E1E', 'drawer-bg': '#FBFAF5',
        font: "'Architects Daughter', 'Comic Sans MS', cursive", display: "'Caveat', 'Architects Daughter', cursive", mono: "'Architects Daughter', monospace",
        radius: '255px 15px 225px 15px / 15px 225px 15px 255px', 'card-border': '2px solid #1E1E1E', 'card-shadow': '3px 3px 0 #1E1E1E', focus: '#1971C2',
      },
    },
  },
  retro: {
    label: 'Retro',
    desc: 'Bevelled grey windows on a teal desktop.',
    fonts: ['Pixelify Sans'],
    schemes: {
      light: {
        bg: '#2A7F7F', surface: '#C3C3C3', 'surface-2': '#FFFFFF', fg: '#000000', muted: '#3A3A3A', line: '#808080',
        accent: '#00007B', 'on-accent': '#FFFFFF', 'accent-soft': '#C7C7F0',
        'appbar-bg': '#00007B', 'appbar-fg': '#FFFFFF', 'drawer-bg': '#C3C3C3',
        font: "Verdana, Tahoma, sans-serif", display: "'Pixelify Sans', Verdana, sans-serif", mono: "'Courier New', monospace",
        radius: '0px', 'card-border': '2px outset #E8E8E8', 'card-shadow': '1px 1px 0 #000', focus: '#00007B',
      },
    },
  },
  ...LEDGER_THEMES,
} as const satisfies Record<string, Theme>;

export type ThemeId = keyof typeof THEMES;
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

export const isThemeId = (v: string): v is ThemeId => (THEME_IDS as readonly string[]).includes(v);
export const isMode = (v: string): v is Mode => v === 'system' || v === 'light' || v === 'dark';

/** Which schemes a theme offers, light first. */
export const schemesOf = (id: ThemeId): readonly Scheme[] =>
  (['light', 'dark'] as const).filter((s) => (THEMES[id].schemes as Partial<Record<Scheme, Tokens>>)[s] !== undefined);

/**
 * The scheme to show: the visitor's choice when the theme has it, otherwise the OS preference when the
 * theme has that, otherwise the theme's only scheme. Pure: `systemDark` is passed in.
 */
export const resolveScheme = (id: ThemeId, mode: Mode, systemDark: boolean): Scheme => {
  const available = schemesOf(id);
  const want: Scheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
  if (available.includes(want)) return want;
  const only = available[0];
  if (!only) throw new Error(`bug: theme ${id} defines no schemes`);
  return only;
};

/** The CSS custom properties for a theme + scheme, as `--name: value` pairs. */
export const themeVars = (id: ThemeId, scheme: Scheme): Readonly<Record<string, string>> => {
  const tokens = (THEMES[id].schemes as Partial<Record<Scheme, Tokens>>)[scheme];
  if (!tokens) throw new Error(`theme ${id} has no ${scheme} scheme`);
  return Object.fromEntries(TOKEN_NAMES.map((k) => [`--${k}`, tokens[k]]));
};
