/**
 * <theme-picker>: choose the theme and light/dark. State lives in src/lib/theme-state.ts.
 *
 *   <theme-picker></theme-picker>                compact: a swatch per theme + light/dark/system (not in the app bar: the profile menu is)
 *   <theme-picker layout="cards"></theme-picker> large cards with previews (the Themes page)
 */
import { LitElement, html, css } from 'lit';
import { THEMES, THEME_IDS, schemesOf, themeVars } from '../lib/themes.ts';
import { DEFAULT_CHOICE, THEME_EVENT, applyChoice, currentChoice, type ThemeChoice } from '../lib/theme-state.ts';
import { requestBus, type Bus } from '../lib/bus.ts';

export class ThemePicker extends LitElement {
  static override properties = { layout: { type: String }, choice: { state: true } };
  declare layout: 'compact' | 'cards';
  declare choice: ThemeChoice;
  private bus: Bus | null = null;

  static override styles = css`
    :host { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
    :host([layout='cards']) { display: block; }
    button { font: inherit; color: inherit; }
    .themes { display: flex; align-items: center; gap: 4px; padding: 3px; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 10px;
      overflow-x: auto; scrollbar-width: none; max-width: min(100%, 70vw); }
    .lbl { font-family: var(--mono); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; opacity: .7; padding: 0 6px 0 8px; }
    .theme-btn { flex: none; display: inline-flex; align-items: center; gap: 8px; min-height: 36px; min-width: 36px; padding: 0 9px; border: 0; border-radius: 7px;
      background: transparent; font-weight: 600; white-space: nowrap; cursor: pointer; }
    .theme-btn:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
    .theme-btn[aria-pressed='true'] { background: color-mix(in srgb, currentColor 20%, transparent); }
    .swatch { position: relative; flex: none; width: 20px; height: 20px; border-radius: 50%; overflow: hidden; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, currentColor 55%, transparent); }
    .theme-btn[aria-pressed='true'] .swatch { box-shadow: inset 0 0 0 1.5px currentColor; }
    .swatch > span { position: absolute; right: 0; top: 0; width: 10px; height: 20px; }
    .swatch > i { position: absolute; left: 4px; bottom: 4px; width: 5px; height: 5px; border-radius: 50%; }
    .seg { display: inline-flex; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 999px; overflow: hidden; }
    .seg button { border: 0; background: transparent; padding: 5px 10px; cursor: pointer; }
    .seg button[aria-pressed='true'] { background: color-mix(in srgb, currentColor 22%, transparent); font-weight: 600; }
    .seg button:disabled { opacity: .45; cursor: default; }
    button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; }
    .card { display: flex; flex-direction: column; gap: 10px; padding: 0; border: 2px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--fg);
      text-align: left; cursor: pointer; overflow: hidden; }
    .card[aria-pressed='true'] { border-color: var(--accent); }
    .preview { display: grid; grid-template-columns: 30% 1fr; grid-template-rows: 18px 1fr; height: 92px; }
    .preview .bar { grid-column: 1 / -1; }
    .preview .main { padding: 8px; display: grid; gap: 6px; align-content: start; }
    .preview .main span { height: 8px; border-radius: 4px; }
    .meta { padding: 0 12px 12px; display: grid; gap: 2px; }
    .meta strong { font-size: 15px; }
    .meta span { color: var(--muted); font-size: 13px; }
    .modes { margin-top: 16px; display: flex; align-items: center; gap: 10px; }
    /* phones: the app bar keeps only the theme menu; light/dark lives on the settings page */
    @media (max-width: 600px) { :host(:not([layout='cards'])) .seg, :host(:not([layout='cards'])) .lbl { display: none; } }
  `;

  constructor() { super(); this.layout = 'compact'; this.choice = DEFAULT_CHOICE; }

  override connectedCallback() {
    super.connectedCallback();
    this.choice = currentChoice(document);
    document.addEventListener(THEME_EVENT, this.onChange);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(THEME_EVENT, this.onChange);
  }

  private onChange = (e: Event) => { this.choice = (e as CustomEvent<ThemeChoice>).detail; };

  private pick(next: ThemeChoice) {
    applyChoice(document, next);
    this.bus ??= requestBus(this);   // asked for on use, so the picker can render outside a shell (throws there if picked)
    this.bus.publish('theme:changed', { theme: next.theme, mode: next.mode, scheme: document.documentElement.dataset['scheme'] }, 'theme-picker');
  }

  private modes() {
    const both = schemesOf(this.choice.theme).length === 2;
    return html`<div class="seg" role="group" aria-label="Light or dark">${(['system', 'light', 'dark'] as const).map((m) => html`<button type="button"
      aria-pressed=${String(both && this.choice.mode === m)} ?disabled=${!both} title=${both ? '' : `${THEMES[this.choice.theme].label} has one look`}
      @click=${() => this.pick({ ...this.choice, mode: m })}>${{ system: 'Auto', light: 'Light', dark: 'Dark' }[m]}</button>`)}</div>`;
  }

  override render() {
    if (this.layout === 'cards') {
      return html`<div class="cards" role="group" aria-label="Theme">${THEME_IDS.map((id) => {
        const t = THEMES[id];
        const s = schemesOf(id)[0];
        if (!s) throw new Error(`bug: theme ${id} has no schemes`);
        const v = themeVars(id, s);
        return html`<button type="button" class="card" aria-pressed=${String(this.choice.theme === id)} @click=${() => this.pick({ ...this.choice, theme: id })}>
          <span class="preview" aria-hidden="true" style="background:${v['--bg']}">
            <span class="bar" style="background:${v['--appbar-bg']}"></span>
            <span style="background:${v['--drawer-bg']};border-right:1px solid ${v['--line']}"></span>
            <span class="main"><span style="background:${v['--accent']};width:60%"></span><span style="background:${v['--surface']};border:${v['--card-border']};height:34px;border-radius:${v['--radius']}"></span></span>
          </span>
          <span class="meta"><strong>${t.label}</strong><span>${t.desc}${schemesOf(id).length === 2 ? ' Light and dark.' : ''}</span></span>
        </button>`;
      })}</div>
      <div class="modes"><span>Appearance</span>${this.modes()}</div>`;
    }
    // A swatch per theme, as in the Decision Ledger: its page, its text (right half) and its accent (the dot),
    // in the scheme now showing when the theme has it.
    const shown = document.documentElement.dataset['scheme'];
    return html`<div class="themes" role="group" aria-label="Theme"><span class="lbl">Theme</span>${THEME_IDS.map((id) => {
        const on = this.choice.theme === id;
        const s = schemesOf(id).find((x) => x === shown) ?? schemesOf(id)[0]!;
        const v = themeVars(id, s);
        return html`<button type="button" class="theme-btn" aria-pressed=${String(on)} aria-label=${`${THEMES[id].label} theme`} title=${THEMES[id].label}
          @click=${() => this.pick({ ...this.choice, theme: id })}>
          <span class="swatch" aria-hidden="true" style=${`background:${v['--bg']}`}><span style=${`background:${v['--fg']}`}></span><i style=${`background:${v['--accent']}`}></i></span>
          ${on ? html`<span>${THEMES[id].label}</span>` : ''}</button>`;
      })}</div>
      ${this.modes()}`;
  }
}

customElements.define('theme-picker', ThemePicker);
