/** The --nano-* tokens (the widgets' contract, see @pritzlaff/nano-elements) for a workspace theme: from its page
 * tokens, its own widget colours, and the scheme's defaults for the rest. */
import { NANO_TOKENS, type NanoToken } from '@pritzlaff/nano-elements';
import { THEMES, type NanoExtras, type Scheme, type ThemeId, type Tokens } from './themes.ts';

/** What a theme that sets no widget colours gets, by scheme. */
const DEFAULTS: Record<Scheme, Required<NanoExtras>> = {
  light: { bg: '', 'fg-2': '', 'border-strong': '', 'radius-s': '', good: '#0B6B5F', 'good-bg': '#DDF1EC', bad: '#A3283C', 'bad-bg': '#F8E1E3', warn: '#6E5100', 'warn-bg': '#F6ECD2',
    s1: '#2E5BDA', s2: '#E0662B', s3: '#0E8576', s4: '#8A4FD0', s5: '#A97C00', s6: '#C2416B', s7: '#1E8FB8', s8: '#4D555C' },
  dark: { bg: '', 'fg-2': '', 'border-strong': '', 'radius-s': '', good: '#5FD0B8', 'good-bg': '#12342E', bad: '#FF8A9A', 'bad-bg': '#3A1D22', warn: '#F1D488', 'warn-bg': '#3A3016',
    s1: '#7FA2FF', s2: '#FF9A5C', s3: '#3FC9AE', s4: '#B58CF0', s5: '#E0B43C', s6: '#F07BA0', s7: '#5CC4EC', s8: '#AEB6BD' },
};

/** Every --nano-* custom property for a theme in a scheme. */
export function nanoVars(id: ThemeId, scheme: Scheme): Record<string, string> {
  const theme = THEMES[id] as { schemes: Partial<Record<Scheme, Tokens>>; nano?: NanoExtras };
  const k = theme.schemes[scheme];
  if (!k) throw new Error(`theme ${id} has no ${scheme} scheme`);
  const x = { ...DEFAULTS[scheme], ...(theme.nano ?? {}) };
  const v: Record<NanoToken, string> = {
    bg: x.bg || k.bg, surface: k.surface, 'surface-2': k['surface-2'], border: k.line, 'border-strong': x['border-strong'] || k.muted,
    fg: k.fg, 'fg-2': x['fg-2'] || k.fg, muted: k.muted, 'on-accent': k['on-accent'],
    accent: k.accent, 'accent-soft': k['accent-soft'], focus: k.focus,
    good: x.good, 'good-bg': x['good-bg'], bad: x.bad, 'bad-bg': x['bad-bg'], warn: x.warn, 'warn-bg': x['warn-bg'],
    font: k.font, 'font-display': k.display, 'font-mono': k.mono, radius: k.radius, 'radius-s': x['radius-s'] || k.radius,
    s1: x.s1, s2: x.s2, s3: x.s3, s4: x.s4, s5: x.s5, s6: x.s6, s7: x.s7, s8: x.s8,
  };
  return Object.fromEntries((Object.keys(NANO_TOKENS) as NanoToken[]).map((t) => [`--nano-${t}`, v[t]]));
}
