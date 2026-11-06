/**
 * <notes-panel>: a scratch pad for the workspace. Each open panel is independent; text lasts for the visit.
 * Publishes notes:changed {chars} after typing pauses.
 */
import { LitElement, html, css } from 'lit';
import { requestBus, type Bus } from '../lib/bus.ts';

export class NotesPanel extends LitElement {
  static override properties = { text: { state: true } };
  declare text: string;
  private bus: Bus | null = null;
  private timer = 0;

  static override styles = css`
    :host { display: flex; flex-direction: column; height: 100%; gap: 8px; }
    textarea { flex: 1; min-height: 120px; resize: none; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius);
      background: var(--bg); color: var(--fg); font: 14px/1.55 var(--font); }
    textarea:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
    small { color: var(--muted); }
  `;

  constructor() { super(); this.text = '[Notes]\n- Drag this tab to dock it somewhere else.\n- Drag a widget from the menu to add one.'; }

  override connectedCallback() { super.connectedCallback(); this.bus ??= requestBus(this); }

  override disconnectedCallback() { super.disconnectedCallback(); clearTimeout(this.timer); }

  private onInput(e: Event) {
    this.text = (e.target as HTMLTextAreaElement).value;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (!this.bus) throw new Error('bug: notes typed before connect');
      this.bus.publish('notes:changed', { chars: this.text.length }, 'notes-panel');
    }, 600);
  }

  override render() {
    return html`<textarea aria-label="Notes" .value=${this.text} @input=${this.onInput}></textarea><small>${this.text.length} characters</small>`;
  }
}

customElements.define('notes-panel', NotesPanel);
