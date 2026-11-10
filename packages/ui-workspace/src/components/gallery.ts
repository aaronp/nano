/**
 * <nano-gallery>: the component library under the page's theme — primitives, type and colour, layouts, and live
 * widgets — or, with Compare themes, the primitives once per theme and scheme side by side. Each column carries its
 * theme's --nano-* tokens, so what is inside takes that theme whatever the page's is.
 */
import { LitElement, css, html } from 'lit';
import { base } from '@pritzlaff/nano-elements';
import { THEMES, THEME_IDS, schemesOf } from '../lib/themes.ts';
import { nanoVars } from '../lib/nano-vars.ts';
import { layouts, live, primitives, typeAndColour } from './gallery-samples.ts';

const TABS = [['Primitives', primitives], ['Type & colour', typeAndColour], ['Layouts', layouts], ['Live', live]] as const;

export class NanoGallery extends LitElement {
  static override properties = { tab: { state: true }, compare: { state: true } };
  static override styles = [base, css`
    :host { display: block; padding: 16px }   /* no background: the theme's page (such as grid paper) shows through */
    .bar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap }
    .bar .tabs { flex: 1 }
    .compare { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(340px, 1fr); gap: 12px; overflow-x: auto }
    .theme-col { background: var(--nano-bg); color: var(--nano-fg); font-family: var(--nano-font); padding: 12px; border-radius: var(--nano-radius);
      border: 1px solid var(--nano-border) }
    .theme-col > h3 { margin: 0 0 10px }
    section + section { margin-top: 18px }`];
  declare tab: number;
  declare compare: boolean;
  constructor() { super(); this.tab = 0; this.compare = false; }

  override render() {
    const bar = html`<div class="bar">
      <div class="tabs" role="tablist">${TABS.map(([name], i) => html`<button role="tab" aria-selected=${String(!this.compare && this.tab === i)}
        @click=${() => { this.tab = i; this.compare = false; }}>${name}</button>`)}</div>
      <label class="row"><input type="checkbox" data-compare .checked=${this.compare} @click=${(e: Event) => { this.compare = (e.target as HTMLInputElement).checked; }}> Compare themes</label></div>`;
    if (!this.compare) return html`${bar}${TABS[this.tab]![1]()}`;
    const cols = THEME_IDS.flatMap((id) => schemesOf(id).map((s) => ({ id, s, label: `${THEMES[id].label}${schemesOf(id).length > 1 ? ` · ${s}` : ''}`, vars: nanoVars(id, s) })));
    return html`${bar}<div class="compare">${cols.map((c) => html`<div class="theme-col" data-theme=${`${c.id}/${c.s}`}
      style=${`color-scheme:${c.s};` + Object.entries(c.vars).map(([k, v]) => `${k}:${v}`).join(';')}><h3 class="display-s">${c.label}</h3>${primitives()}</div>`)}</div>`;
  }
}

if (!customElements.get('nano-gallery')) customElements.define('nano-gallery', NanoGallery);
