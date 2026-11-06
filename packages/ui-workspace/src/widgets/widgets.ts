/**
 * Example widgets used by the demo pages. Each one gets the bus from the shell when it connects and talks
 * only through topics, so you can move them between pages (or delete them) freely.
 *
 *   <stat-card index="0">          a figure with a sparkline (data from sample-data.ts)
 *   <line-chart>                   weekly chart; follows stat:select
 *   <bus-log pattern="*" limit="8"> recent bus messages
 *   <status-line>                  the latest bus message, for the status bar
 *   <mail-folders> <mail-list> <mail-reader>   the Inbox page (mail:folder, mail:open)
 *   <file-list> <code-pane>        the Editor page (file:open, file:saved)
 */
import { LitElement, html, css, svg } from 'lit';
import { requestBus, type Bus, type BusMessage, type Unsubscribe } from '../lib/bus.ts';
import { areaPath, changePct, linePath, scalePoints } from '../lib/chart.ts';
import { DAYS, FILES, FOLDERS, MESSAGES, STATS, type Message } from './sample-data.ts';

/** Base class: keeps the bus from the first connection and tears down subscriptions. */
abstract class BusWidget extends LitElement {
  protected bus: Bus | null = null;
  private subs: Unsubscribe[] = [];

  override connectedCallback() {
    super.connectedCallback();
    this.bus ??= requestBus(this);
    this.subs = this.subscriptions(this.bus);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    for (const off of this.subs) off();
    this.subs = [];
  }

  /** Override to subscribe; return the unsubscribe functions. */
  protected subscriptions(_bus: Bus): Unsubscribe[] { return []; }

  protected send(topic: string, payload: unknown) {
    if (!this.bus) throw new Error(`bug: <${this.localName}> published before it was connected`);
    this.bus.publish(topic, payload, this.localName);
  }
}

const card = css`
  :host { display: block; box-sizing: border-box; background: var(--surface); color: var(--fg); border: var(--card-border); border-radius: var(--radius);
    box-shadow: var(--card-shadow); padding: 16px; min-width: 0; }
  h3 { margin: 0; font: 600 13px/1.3 var(--font); color: var(--muted); letter-spacing: .02em; }
  button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
`;

/* ------------------------------------------------------------------ dashboard */

export class StatCard extends BusWidget {
  static override properties = { index: { type: Number } };
  declare index: number;
  static override styles = [card, css`
    :host { padding: 0; }
    button { all: unset; box-sizing: border-box; display: grid; gap: 4px; width: 100%; padding: 14px 16px; cursor: pointer; border-radius: var(--radius); }
    :host([aria-current='true']) { outline: 2px solid var(--accent); outline-offset: -1px; }
    .value { font: 600 28px/1.1 var(--display); font-variant-numeric: tabular-nums; }
    .delta { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
    svg { width: 100%; height: 36px; display: block; }
  `];
  constructor() { super(); this.index = 0; }

  protected override subscriptions(bus: Bus) {
    this.setAttribute('aria-current', String(this.index === 0));
    return [bus.subscribe('stat:select', (m) => { this.setAttribute('aria-current', String((m.payload as { index: number }).index === this.index)); })];
  }

  override render() {
    const s = STATS[this.index];
    if (!s) throw new Error(`<stat-card index="${this.index}"> has no data in STATS`);
    const last = s.values[s.values.length - 1];
    const pts = scalePoints(s.values, 200, 36, 3);
    const pct = changePct(s.values);
    return html`<button type="button" aria-label="Show ${s.label} on the chart" @click=${() => this.send('stat:select', { index: this.index, label: s.label })}>
      <h3>${s.label}</h3>
      <span class="value">${last}${s.unit}</span>
      <span class="delta">${pct > 0 ? '▲' : pct < 0 ? '▼' : '•'} ${Math.abs(pct)}% this week</span>
      <svg viewBox="0 0 200 36" preserveAspectRatio="none" aria-hidden="true">${svg`
        <path d=${areaPath(pts, 36)} fill="var(--accent-soft)"></path>
        <path d=${linePath(pts)} fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"></path>`}</svg>
    </button>`;
  }
}

export class LineChart extends BusWidget {
  static override properties = { index: { state: true } };
  declare index: number;
  static override styles = [card, css`
    :host { display: flex; flex-direction: column; gap: 10px; height: 100%; }
    .head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    h2 { margin: 0; font: 600 18px/1.2 var(--display); }
    .wrap { flex: 1; min-height: 160px; }
    svg { width: 100%; height: 100%; display: block; overflow: visible; }
    text { fill: var(--muted); font: 11px var(--font); }
  `];
  constructor() { super(); this.index = 0; }

  protected override subscriptions(bus: Bus) {
    return [bus.subscribe('stat:select', (m) => { this.index = (m.payload as { index: number }).index; })];
  }

  override render() {
    const s = STATS[this.index];
    if (!s) throw new Error(`bug: no stat ${this.index}`);
    const W = 600, H = 220, P = 24;
    const pts = scalePoints(s.values, W, H, P);
    const lo = Math.min(...s.values), hi = Math.max(...s.values);
    return html`<div class="head"><h2>${s.label}</h2><h3>Last 7 days · click a metric card to switch</h3></div>
      <div class="wrap"><svg viewBox="0 0 ${W} ${H + 18}" preserveAspectRatio="none" role="img" aria-label="${s.label} from ${lo} to ${hi}${s.unit} over the week">${svg`
        ${[0, 0.5, 1].map((f) => svg`<line x1=${P} x2=${W - P} y1=${P + (H - 2 * P) * f} y2=${P + (H - 2 * P) * f} stroke="var(--line)" stroke-dasharray="3 4"></line>`)}
        <path d=${areaPath(pts, H - P)} fill="var(--accent-soft)" opacity=".7"></path>
        <path d=${linePath(pts)} fill="none" stroke="var(--accent)" stroke-width="2.5" vector-effect="non-scaling-stroke"></path>
        ${pts.map((p, i) => svg`<circle cx=${p.x} cy=${p.y} r=${i === pts.length - 1 ? 5 : 3} fill=${i === pts.length - 1 ? 'var(--accent)' : 'var(--surface)'} stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"></circle>`)}
        ${pts.map((p, i) => svg`<text x=${p.x} y=${H + 12} text-anchor="middle">${DAYS[i] ?? ''}</text>`)}
        <text x=${P} y=${P - 8}>${hi}${s.unit}</text><text x=${P} y=${H - P + 14}>${lo}${s.unit}</text>`}
      </svg></div>`;
  }
}

/* ------------------------------------------------------------------ bus views */

export class BusLog extends BusWidget {
  static override properties = { pattern: { type: String }, limit: { type: Number }, messages: { state: true } };
  declare pattern: string;
  declare limit: number;
  declare messages: readonly BusMessage[];
  static override styles = css`
    :host { display: block; font: 12px/1.6 var(--mono); }
    ol { margin: 0; padding: 0; list-style: none; }
    li { display: grid; grid-template-columns: 3ch 14ch minmax(0, 1fr); gap: 10px; }
    .seq { color: var(--muted); text-align: right; } .topic { color: var(--accent); font-weight: 600; }
    .payload { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .empty { color: var(--muted); margin: 0; }
  `;
  constructor() { super(); this.pattern = '*'; this.limit = 8; this.messages = []; }

  protected override subscriptions(bus: Bus) {
    this.messages = bus.history().slice(-this.limit);
    return [bus.subscribe(this.pattern, (m) => { this.messages = [...this.messages, m].slice(-this.limit); })];
  }

  override render() {
    if (this.messages.length === 0) return html`<p class="empty">Waiting for messages on “${this.pattern}”…</p>`;
    return html`<ol aria-live="polite">${this.messages.map((m) => html`<li><span class="seq">${m.seq}</span><span class="topic">${m.topic}</span>
      <span class="payload">${JSON.stringify(m.payload)}</span></li>`)}</ol>`;
  }
}

export class StatusLine extends BusWidget {
  static override properties = { last: { state: true } };
  declare last: BusMessage | null;
  static override styles = css`:host { font-variant-numeric: tabular-nums; } code { font: 12px var(--mono); }`;
  constructor() { super(); this.last = null; }
  protected override subscriptions(bus: Bus) {
    this.last = bus.history().at(-1) ?? null;
    return [bus.subscribe('*', (m) => { this.last = m; })];
  }
  override render() {
    return this.last ? html`Last event: <code>${this.last.topic}</code> from ${this.last.source}` : html`Ready`;
  }
}

/* ------------------------------------------------------------------ inbox */

export class MailFolders extends BusWidget {
  static override properties = { folder: { state: true } };
  declare folder: Message['folder'];
  static override styles = css`
    :host { display: block; height: 100%; box-sizing: border-box; padding: 16px 10px; background: var(--surface); }
    h2 { margin: 0 8px 10px; font: 600 12px var(--font); color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
    button { all: unset; box-sizing: border-box; display: flex; justify-content: space-between; width: 100%; padding: 7px 10px; border-radius: var(--radius); cursor: pointer; }
    button:hover { background: var(--surface-2); }
    button[aria-current='true'] { background: var(--accent-soft); font-weight: 600; }
    button:focus-visible { outline: 2px solid var(--focus); }
    .n { color: var(--muted); font-variant-numeric: tabular-nums; }
  `;
  constructor() { super(); this.folder = 'inbox'; }
  override render() {
    return html`<h2>Folders</h2>${FOLDERS.map((f) => {
      const unread = MESSAGES.filter((m) => m.folder === f.id && m.unread).length;
      return html`<button type="button" aria-current=${String(this.folder === f.id)} @click=${() => { this.folder = f.id; this.send('mail:folder', { folder: f.id }); }}>
        <span>${f.label}</span><span class="n">${unread || ''}</span></button>`;
    })}`;
  }
}

export class MailList extends BusWidget {
  static override properties = { folder: { state: true }, open: { state: true } };
  declare folder: Message['folder'];
  declare open: string | null;
  static override styles = css`
    :host { display: block; height: 100%; background: var(--bg); }
    ul { margin: 0; padding: 0; list-style: none; }
    button { all: unset; box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; width: 100%; padding: 12px 16px;
      border-bottom: 1px solid var(--line); cursor: pointer; }
    button:hover { background: var(--surface-2); }
    button[aria-current='true'] { background: var(--accent-soft); }
    button:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
    .from { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .unread .from::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 8px; border-radius: 99px; background: var(--accent); }
    .when { color: var(--muted); font-size: 12px; }
    .subject, .preview { grid-column: 1 / -1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .preview { color: var(--muted); font-size: 13px; }
    .empty { padding: 24px 16px; color: var(--muted); }
  `;
  constructor() { super(); this.folder = 'inbox'; this.open = null; }
  protected override subscriptions(bus: Bus) {
    return [bus.subscribe('mail:folder', (m) => { this.folder = (m.payload as { folder: Message['folder'] }).folder; })];
  }
  override render() {
    const list = MESSAGES.filter((m) => m.folder === this.folder);
    if (list.length === 0) return html`<p class="empty">Nothing in this folder.</p>`;
    return html`<ul aria-label="Messages">${list.map((m) => html`<li><button type="button" class=${m.unread ? 'unread' : ''} aria-current=${String(this.open === m.id)}
      @click=${() => { this.open = m.id; this.send('mail:open', { id: m.id }); }}>
      <span class="from">${m.from}</span><span class="when">${m.when}</span><span class="subject">${m.subject}</span><span class="preview">${m.preview}</span></button></li>`)}</ul>`;
  }
}

export class MailReader extends BusWidget {
  static override properties = { messageId: { state: true } };
  declare messageId: string | null;
  static override styles = css`
    :host { display: block; height: 100%; box-sizing: border-box; padding: 24px 28px; background: var(--surface); }
    h2 { margin: 0 0 6px; font: 600 22px/1.25 var(--display); text-wrap: balance; }
    .meta { color: var(--muted); font-size: 13px; margin-bottom: 18px; }
    p { max-width: 64ch; }
    .empty { color: var(--muted); display: grid; place-items: center; height: 100%; text-align: center; }
  `;
  constructor() { super(); this.messageId = null; }
  protected override subscriptions(bus: Bus) {
    return [bus.subscribe('mail:open', (m) => { this.messageId = (m.payload as { id: string }).id; })];
  }
  override render() {
    const m = MESSAGES.find((x) => x.id === this.messageId);
    if (!m) return html`<div class="empty"><p>Select a message to read it here.<br>Drag the dividers to resize the three panes.</p></div>`;
    return html`<article><h2>${m.subject}</h2><div class="meta">From ${m.from} · ${m.when}</div>${m.body.map((p) => html`<p>${p}</p>`)}</article>`;
  }
}

/* ------------------------------------------------------------------ editor */

export class FileList extends BusWidget {
  static override properties = { open: { state: true } };
  declare open: string;
  static override styles = css`
    :host { display: block; height: 100%; box-sizing: border-box; padding: 12px 8px; background: var(--surface); font: 13px var(--mono); }
    h2 { margin: 0 8px 8px; font: 600 12px var(--font); color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
    button { all: unset; box-sizing: border-box; display: block; width: 100%; padding: 5px 10px; border-radius: var(--radius); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    button:hover { background: var(--surface-2); }
    button[aria-current='true'] { background: var(--accent-soft); }
    button:focus-visible { outline: 2px solid var(--focus); }
  `;
  constructor() { super(); this.open = FILES[0]?.path ?? ''; }
  override render() {
    return html`<h2>Explorer</h2>${FILES.map((f) => html`<button type="button" aria-current=${String(this.open === f.path)}
      @click=${() => { this.open = f.path; this.send('file:open', { path: f.path }); }}>${f.path}</button>`)}`;
  }
}

export class CodePane extends BusWidget {
  static override properties = { path: { state: true }, edits: { state: true }, saved: { state: true } };
  declare path: string;
  /** Unsaved text per file. */ declare edits: Readonly<Record<string, string>>;
  /** Last saved text per file (a real app would write to its API here). */ declare saved: Readonly<Record<string, string>>;
  static override styles = css`
    :host { display: flex; flex-direction: column; height: 100%; background: var(--bg); }
    .tab { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--line); font: 13px var(--mono); }
    .tab span { flex: 1; }
    button { font: inherit; padding: 3px 10px; border-radius: var(--radius); border: 1px solid var(--line); background: var(--surface); color: var(--fg); cursor: pointer; }
    textarea { flex: 1; min-height: 0; resize: none; border: 0; padding: 14px 16px; background: transparent; color: var(--fg); font: 13px/1.6 var(--mono); tab-size: 2; }
    textarea:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  `;
  constructor() { super(); this.path = FILES[0]?.path ?? ''; this.edits = {}; this.saved = {}; }
  protected override subscriptions(bus: Bus) {
    return [bus.subscribe('file:open', (m) => { this.path = (m.payload as { path: string }).path; })];
  }
  override render() {
    const f = FILES.find((x) => x.path === this.path);
    if (!f) throw new Error(`bug: no file ${this.path}`);
    const base = this.saved[f.path] ?? f.text;
    const text = this.edits[f.path] ?? base;
    const dirty = text !== base;
    return html`<div class="tab"><span>${f.path}${dirty ? ' •' : ''}</span>
        <button type="button" ?disabled=${!dirty} @click=${() => { this.saved = { ...this.saved, [f.path]: text }; this.send('file:saved', { path: f.path, bytes: text.length }); }}>Save</button></div>
      <textarea aria-label="Contents of ${f.path}" spellcheck="false" .value=${text}
        @input=${(e: Event) => { this.edits = { ...this.edits, [f.path]: (e.target as HTMLTextAreaElement).value }; }}></textarea>`;
  }
}

customElements.define('stat-card', StatCard);
customElements.define('line-chart', LineChart);
customElements.define('bus-log', BusLog);
customElements.define('status-line', StatusLine);
customElements.define('mail-folders', MailFolders);
customElements.define('mail-list', MailList);
customElements.define('mail-reader', MailReader);
customElements.define('file-list', FileList);
customElements.define('code-pane', CodePane);

