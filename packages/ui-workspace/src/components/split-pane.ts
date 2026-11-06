/**
 * <split-pane>: resizable columns or rows. Every child element is a pane; a draggable divider sits between
 * each pair. Nest split panes for grids (columns inside a row, etc.).
 *
 *   <split-pane direction="row" sizes="1,2" min="160" collapse-below="700" storage-key="inbox">
 *     <section>…</section> <section>…</section>
 *   </split-pane>
 *
 * - direction  "row" = side by side (columns), "column" = stacked (rows). Default row.
 * - sizes      starting weights, one per pane ("30,70" or "1,2"). Default equal.
 * - min        smallest pane in px (default 120).
 * - collapse-below  container width in px under which panes stack with no dividers (phones).
 * - storage-key     remember sizes in this browser under this key (optional).
 *
 * Dividers: drag, or focus and use arrow keys (Shift = bigger steps), Home/End, double-click to reset.
 * Bus topic: split:resized {key, sizes} when a drag or key press ends.
 */
import { LitElement, html, css } from 'lit';
import { gridTracks, parseSizes, pxToFraction, resizeAt } from '../lib/split.ts';
import { requestBus, type Bus } from '../lib/bus.ts';

const DIVIDER = 8;

export class SplitPane extends LitElement {
  static override properties = {
    direction: { type: String, reflect: true }, min: { type: Number }, collapseBelow: { type: Number, attribute: 'collapse-below' },
    storageKey: { type: String, attribute: 'storage-key' },
    sizes: { state: true }, count: { state: true }, stacked: { state: true }, dragging: { state: true },
  };
  declare direction: 'row' | 'column';
  declare min: number;
  declare collapseBelow: number;
  declare storageKey: string;
  declare sizes: readonly number[];
  declare count: number;
  declare stacked: boolean;
  declare dragging: number;
  private initial: readonly number[] = [];
  private ro: ResizeObserver | null = null;
  private bus: Bus | null = null;

  static override styles = css`
    :host { display: block; min-width: 0; min-height: 0; height: 100%; }
    .grid { display: grid; width: 100%; height: 100%; min-height: 0; }
    .grid.stacked { display: flex; flex-direction: column; gap: 12px; height: auto; }
    ::slotted(*) { min-width: 0; min-height: 0; overflow: auto; }
    .div { position: relative; display: grid; place-items: center; background: transparent; touch-action: none; }
    .div::before { content: ''; position: absolute; background: var(--line); }
    :host([direction='row']) .div, :host(:not([direction])) .div { cursor: col-resize; }
    :host([direction='row']) .div::before, :host(:not([direction])) .div::before { top: 0; bottom: 0; left: 50%; width: 1px; }
    :host([direction='column']) .div { cursor: row-resize; }
    :host([direction='column']) .div::before { left: 0; right: 0; top: 50%; height: 1px; }
    .grip { position: relative; border-radius: 99px; background: var(--muted); opacity: .45; transition: opacity .15s, background .15s; }
    :host([direction='row']) .grip, :host(:not([direction])) .grip { width: 4px; height: 28px; }
    :host([direction='column']) .grip { width: 28px; height: 4px; }
    .div:hover .grip, .div[data-active] .grip, .div:focus-visible .grip { opacity: 1; background: var(--accent); }
    .div:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  `;

  constructor() {
    super();
    this.direction = 'row'; this.min = 120; this.collapseBelow = 0; this.storageKey = '';
    this.sizes = []; this.count = 0; this.stacked = false; this.dragging = -1;
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.direction !== 'row' && this.direction !== 'column') throw new Error(`<split-pane> direction must be row or column, got ${String(this.direction)}`);
    this.bus ??= requestBus(this);
    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(this);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.ro?.disconnect();
    this.ro = null;
  }

  private panes(): HTMLElement[] { return [...this.children].filter((c): c is HTMLElement => c instanceof HTMLElement); }

  private onSlotChange = () => {
    const panes = this.panes();
    panes.forEach((p, i) => { p.slot = `p${i}`; });
    this.count = panes.length;
    this.initial = parseSizes(this.getAttribute('sizes'), panes.length);
    this.sizes = this.load() ?? this.initial;
  };

  private measure() {
    const stacked = this.collapseBelow > 0 && this.getBoundingClientRect().width < this.collapseBelow;
    if (stacked !== this.stacked) this.stacked = stacked;
  }

  private length(): number {
    const r = this.getBoundingClientRect();
    return this.direction === 'row' ? r.width : r.height;
  }

  private minFraction(): number {
    return Math.min(pxToFraction(this.min, this.length(), this.count - 1, DIVIDER), 1 / this.count);
  }

  private move(i: number, deltaPx: number) {
    const d = pxToFraction(deltaPx, this.length(), this.count - 1, DIVIDER);
    this.sizes = resizeAt(this.sizes, i, d, this.minFraction());
  }

  private onPointerDown(e: PointerEvent, i: number) {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    this.dragging = i;
    let last = this.direction === 'row' ? e.clientX : e.clientY;
    const onMove = (ev: PointerEvent) => {
      const now = this.direction === 'row' ? ev.clientX : ev.clientY;
      this.move(i, now - last);
      last = now;
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      this.dragging = -1;
      this.committed();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  private onKey(e: KeyboardEvent, i: number) {
    const fwd = this.direction === 'row' ? 'ArrowRight' : 'ArrowDown';
    const back = this.direction === 'row' ? 'ArrowLeft' : 'ArrowUp';
    const step = (e.shiftKey ? 0.1 : 0.02) * (this.length() - (this.count - 1) * DIVIDER);
    if (e.key === fwd) this.move(i, step);
    else if (e.key === back) this.move(i, -step);
    else if (e.key === 'Home') this.move(i, -this.length());
    else if (e.key === 'End') this.move(i, this.length());
    else return;
    e.preventDefault();
    this.committed();
  }

  private reset() { this.sizes = this.initial; this.committed(); }

  private committed() {
    this.save();
    if (!this.bus) throw new Error('bug: split-pane resized before it was connected');
    this.bus.publish('split:resized', { key: this.storageKey || null, sizes: this.sizes.map((s) => Math.round(s * 1000) / 1000) }, 'split-pane');
  }

  /* Remembering sizes is a convenience: when storage is unavailable the split simply starts at `sizes`. */
  private load(): readonly number[] | null {
    if (!this.storageKey) return null;
    let raw: string | null = null;
    try { raw = localStorage.getItem(`split:${this.storageKey}`); } catch { return null; }
    if (raw === null) return null;
    try { return parseSizes(raw, this.count); } catch { return null; }
  }

  private save() {
    if (!this.storageKey) return;
    try { localStorage.setItem(`split:${this.storageKey}`, this.sizes.join(',')); } catch { /* storage unavailable: sizes last for this visit only */ }
  }

  override render() {
    const tracks = this.sizes.length ? gridTracks(this.sizes, DIVIDER) : '';
    const style = this.stacked ? '' : this.direction === 'row' ? `grid-template-columns:${tracks}` : `grid-template-rows:${tracks}`;
    const label = this.direction === 'row' ? 'Resize columns' : 'Resize rows';
    const parts = Array.from({ length: this.count }, (_, i) => {
      const pane = html`<slot name="p${i}"></slot>`;
      if (i === this.count - 1 || this.stacked) return pane;
      const now = Math.round((this.sizes.slice(0, i + 1).reduce((a, b) => a + b, 0)) * 100);
      return html`${pane}<div class="div" role="separator" tabindex="0" aria-label=${label} aria-orientation=${this.direction === 'row' ? 'vertical' : 'horizontal'}
        aria-valuemin="0" aria-valuemax="100" aria-valuenow=${now} ?data-active=${this.dragging === i}
        @pointerdown=${(e: PointerEvent) => this.onPointerDown(e, i)} @keydown=${(e: KeyboardEvent) => this.onKey(e, i)} @dblclick=${() => this.reset()}><span class="grip"></span></div>`;
    });
    return html`<div class="grid ${this.stacked ? 'stacked' : ''}" style=${style}>${parts}</div><slot hidden @slotchange=${this.onSlotChange}></slot>`;
  }
}

customElements.define('split-pane', SplitPane);
