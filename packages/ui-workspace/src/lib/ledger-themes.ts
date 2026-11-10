/**
 * The Decision Ledger's four themes (from the adr viewer): Graph paper, Night shift, Blueprint, Warm ledger. Each has
 * one scheme, the page tokens every theme defines, the widget colours the --nano-* contract adds (`nano`), and a
 * grid-paper page background.
 */
import type { NanoExtras, Tokens } from './themes.ts';

const SANS = "'IBM Plex Sans', system-ui, sans-serif", MONO = "'IBM Plex Mono', ui-monospace, monospace";
const BRICOLAGE = "'Bricolage Grotesque', system-ui, sans-serif";
const grid = (line: string) => `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`;
const series = (s: string) => Object.fromEntries(s.split(' ').map((c, i) => [`s${i + 1}`, c])) as Record<`s${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`, string>;

type Ledger = { label: string; desc: string; fonts: readonly string[]; background: string; schemes: { light?: Tokens; dark?: Tokens }; nano: NanoExtras };

export const LEDGER_THEMES = {
  paper: {
    label: 'Graph paper', desc: 'Ink on graph paper, with an orange mark.', fonts: ['Bricolage Grotesque', 'IBM Plex Sans', 'IBM Plex Mono'], background: grid('#DFE3E1'),
    schemes: { light: {
      bg: '#F2F4F3', surface: '#FFFFFF', 'surface-2': '#F7F8F7', fg: '#15181C', muted: '#4D555C', line: '#D9DDDB',
      accent: '#1F45B0', 'on-accent': '#FFFFFF', 'accent-soft': '#F1F5FE', 'appbar-bg': '#15181C', 'appbar-fg': '#F2F4F3', 'drawer-bg': '#FFFFFF',
      font: SANS, display: BRICOLAGE, mono: MONO, radius: '14px', 'card-border': '1px solid #D9DDDB', 'card-shadow': 'none', focus: '#2E5BDA' } },
    nano: { 'fg-2': '#3A4148', 'border-strong': '#8A9197', 'radius-s': '8px', good: '#0B6B5F', 'good-bg': '#DDF1EC', bad: '#A3283C', 'bad-bg': '#F8E1E3',
      warn: '#6E5100', 'warn-bg': '#F6ECD2', ...series('#2E5BDA #E0662B #0E8576 #8A4FD0 #A97C00 #C2416B #1E8FB8 #4D555C') },
  },
  night: {
    label: 'Night shift', desc: 'The ledger after dark.', fonts: ['Bricolage Grotesque', 'IBM Plex Sans', 'IBM Plex Mono'], background: grid('#2C3137'),
    schemes: { dark: {
      bg: '#111316', surface: '#1A1D21', 'surface-2': '#20242A', fg: '#ECEFED', muted: '#A9B0B6', line: '#2E333A',
      accent: '#8FB0FF', 'on-accent': '#111316', 'accent-soft': '#1E2635', 'appbar-bg': '#0B0D0F', 'appbar-fg': '#ECEFED', 'drawer-bg': '#1A1D21',
      font: SANS, display: BRICOLAGE, mono: MONO, radius: '14px', 'card-border': '1px solid #2E333A', 'card-shadow': 'none', focus: '#8FB0FF' } },
    nano: { 'fg-2': '#C9CED2', 'border-strong': '#6B737B', 'radius-s': '8px', good: '#5FD0B8', 'good-bg': '#12342E', bad: '#FF8A9A', 'bad-bg': '#3A1D22',
      warn: '#F1D488', 'warn-bg': '#3A3016', ...series('#7FA2FF #FF9A5C #3FC9AE #B58CF0 #E0B43C #F07BA0 #5CC4EC #AEB6BD') },
  },
  blueprint: {
    label: 'Blueprint', desc: 'White lines on blueprint blue, in mono.', fonts: ['IBM Plex Sans', 'IBM Plex Mono'], background: grid('#1D4072'),
    schemes: { dark: {
      bg: '#0F2747', surface: '#133059', 'surface-2': '#17386A', fg: '#F1F6FF', muted: '#B4C8E8', line: '#2A4F84',
      accent: '#9CC8FF', 'on-accent': '#0F2747', 'accent-soft': '#1C4479', 'appbar-bg': '#0A1C35', 'appbar-fg': '#F1F6FF', 'drawer-bg': '#133059',
      font: SANS, display: MONO, mono: MONO, radius: '14px', 'card-border': '1px solid #2A4F84', 'card-shadow': 'none', focus: '#FFB347' } },
    nano: { 'fg-2': '#CFDDF5', 'border-strong': '#7FA3D6', 'radius-s': '8px', good: '#7EE0C3', 'good-bg': '#12403F', bad: '#FF9DA8', 'bad-bg': '#4A1F33',
      warn: '#FFE29A', 'warn-bg': '#4A3D17', ...series('#9CC8FF #FFB347 #7EE0C3 #D3A6FF #FFE07A #FF9DB8 #6FE3FF #C9D6EA') },
  },
  warm: {
    label: 'Warm ledger', desc: 'Oxblood ink on cream, with a serif.', fonts: ['Fraunces', 'IBM Plex Sans', 'IBM Plex Mono'], background: grid('#E2D8C5'),
    schemes: { light: {
      bg: '#F5F0E6', surface: '#FFFDF8', 'surface-2': '#F9F4EA', fg: '#231C14', muted: '#5C5044', line: '#DDD2BE',
      accent: '#8A3B1F', 'on-accent': '#FFF8EE', 'accent-soft': '#F7EBDD', 'appbar-bg': '#2B211A', 'appbar-fg': '#F5F0E6', 'drawer-bg': '#FFFDF8',
      font: SANS, display: "'Fraunces', Georgia, 'Times New Roman', serif", mono: MONO, radius: '14px', 'card-border': '1px solid #DDD2BE', 'card-shadow': 'none', focus: '#7A2E1C' } },
    nano: { 'fg-2': '#4A3F33', 'border-strong': '#8F806A', 'radius-s': '8px', good: '#2F6B3A', 'good-bg': '#E0EBD9', bad: '#9E2A2A', 'bad-bg': '#F3DCD6',
      warn: '#6A4B0B', 'warn-bg': '#F2E3C2', ...series('#2F5A9E #C8642B #2F6B3A #7A4A9E #A07800 #9E2A4A #2A7F95 #6E6152') },
  },
} as const satisfies Record<string, Ledger>;
