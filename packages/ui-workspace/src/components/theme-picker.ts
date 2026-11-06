/**
 * <theme-picker>: choose the theme and light/dark. State lives in src/lib/theme-state.ts.
 *
 *   <theme-picker></theme-picker>                compact: theme select + light/dark/system (app bar)
 *   <theme-picker layout="cards"></theme-picker> large cards with previews (settings page)
 */
import { LitElement, html, css } from 'lit';
import { THEMES, THEME_IDS, isThemeId, schemesOf, themeVars } from '../lib/themes.ts';
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
    select, button { font: inherit; color: inherit; }
    select { padding: 6px 8px; border-radius: var(--radius); border: 1px solid color-mix(in srgb, currentColor 35%, transparent); background: transparent; }
    select option { color: #000; }
    .seg { display: inline-flex; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 999px; overflow: hidden; }
    .seg button { border: 0; background: transparent; padding: 5px 10px; cursor: pointer; }
    .seg button[aria-pressed='true'] { background: color-mix(in srgb, currentColor 22%, transparent); font-weight: 600; }
    .seg button:disabled { opacity: .45; cursor: default; }
    button:focus-visible, select:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
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
    this.bus ??= requestBus(this);
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
    if (!this.bus) throw new Error('bug: theme picked before the picker was connected');
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
    return html`<label><span class="lbl">Theme</span> <select aria-label="Theme" .value=${this.choice.theme}
        @change=${(e: Event) => { const v = (e.target as HTMLSelectElement).value; if (!isThemeId(v)) throw new Error(`bug: unknown theme ${v}`); this.pick({ ...this.choice, theme: v }); }}>
        ${THEME_IDS.map((id) => html`<option value=${id} ?selected=${this.choice.theme === id}>${THEMES[id].label}</option>`)}</select></label>
      ${this.modes()}`;
  }
}

customElements.define('theme-picker', ThemePicker);
