/**
 * <connection-designer>: a puzzle-style editor for declarative connections. Components present in the scope are
 * listed in a palette; each op is a piece (input: a hole on the left; output: a knob on the right; shapes from the
 * types' SAIDs). Pieces joined in a row are a workflow. Fan-out connections are rules in a side list. Every intent
 * shows its live plan status; "Live" hands the intents to an orchestrator, which wires the scope to match.
 * The document (`{ intents, layout }`) is shown as JSON, and can be copied, loaded and kept in localStorage.
 *
 * Gets its scope from the nearest `provideScope`, or set `.scope`. Attributes: `storage-key` (optional).
 */
import { LitElement, css, html, nothing, svg } from 'lit'
import type { Instance, Scope } from '@composable/sdk'
import { Orchestrators, plan, type Connection, type InstanceSel, type Orchestrator, type Plan, type Problem } from '@composable/connections'
import { base, requestScope, t } from '@composable/ui'
import {
  addConnection, board, componentKey, connections, emptyDoc, joins, look, move, palette, partners, pin, place, remove,
  stepFor, take, toggle, workflows, type BoardPiece, type Doc, type PaletteEntry, type PieceSpec, type TypeInfo,
} from './model'

const W = 150, H = 60, D = 14, CELL_W = W, CELL_H = 92, COLS = 8, ROWS = 6
let seq = 0
const newId = () => `w${(++seq).toString(36)}${Date.now().toString(36).slice(-3)}`

/** One side's bump, from (x, ya) to (x, yb): outwards (+x) for a knob on the right, inwards (+x) for a hole on the left. */
function bump(x: number, ya: number, yb: number, ty: TypeInfo | undefined): string {
  if (!ty) return `L ${x} ${yb}`
  const s = Math.sign(yb - ya), cy = (ya + yb) / 2
  if (ty.any) return `L ${x} ${cy - s * 10} L ${x + D} ${cy - s * 10} L ${x + D} ${cy + s * 10} L ${x} ${cy + s * 10} L ${x} ${yb}`
  const l = look(ty), n = l.neck * H / 2, h = l.head * H, c = cy + l.lift * H * 0.3
  return `L ${x} ${cy - s * n} C ${x + D * 0.15} ${cy - s * n} ${x + D} ${c - s * h} ${x + D} ${c} ` +
    `C ${x + D} ${c + s * h} ${x + D * 0.15} ${cy + s * n} ${x} ${cy + s * n} L ${x} ${yb}`
}
const tile = (p: PieceSpec) => `M 0 0 L ${W} 0 ${bump(W, 0, H, p.output)} L 0 ${H} ${bump(0, H, 0, p.input)} Z`
const hue = (ty?: TypeInfo) => ty && !ty.any ? `hsl(${look(ty).hue} 62% 62%)` : 'var(--c-surface, #f5f5f4)'

const problemText = (p: Problem, names: Map<string, string>): string =>
  p.kind === 'no-match' ? `nothing matches ${p.at}`
    : p.kind === 'ambiguous' ? `${p.at} matches ${p.instances.join(', ')}: pin one`
      : p.kind === 'no-op' ? `${p.at} has no ${p.op.split('/').pop()}`
        : p.kind === 'type-mismatch' ? `${p.at}: ${names.get(p.output) ?? p.output.slice(0, 8)} does not fit ${names.get(p.input) ?? p.input.slice(0, 8)}`
          : (() => { throw new Error(`unknown problem ${JSON.stringify(p)}`) })()

type Drag = { kind: 'new'; entry: PaletteEntry; piece: PieceSpec } | { kind: 'move'; at: BoardPiece; piece: PieceSpec }

export class ConnectionDesigner extends LitElement {
  static properties = { scope: { attribute: false }, storageKey: { attribute: 'storage-key' } }
  declare scope?: Scope
  declare storageKey?: string
  #instances: Instance[] = []
  #doc: Doc = emptyDoc()
  #live = false
  #drag?: Drag
  #json = ''
  #jsonError = ''
  #orch?: Orchestrator
  #unwatch?: () => void

  override connectedCallback() {
    super.connectedCallback()
    this.#doc = this.#load() ?? this.#doc
    queueMicrotask(() => this.#attach())
  }
  override disconnectedCallback() { super.disconnectedCallback(); this.#unwatch?.(); this.#unwatch = undefined; this.#orch?.stop(); this.#orch = undefined }

  #attach() {
    if (this.#unwatch || !this.isConnected) return
    this.scope ??= requestScope(this)
    if (!this.scope) return
    this.#unwatch = this.scope.context('connection-designer').watch(list => { this.#instances = list; this.requestUpdate() })
  }

  // ---- document
  #set(doc: Doc) {
    this.#doc = doc
    this.#json = ''
    if (this.storageKey) try { localStorage.setItem(this.storageKey, JSON.stringify(doc)) } catch {}
    if (this.#live) this.#orch?.set(doc.intents)
    this.requestUpdate()
  }
  #load(): Doc | undefined {
    if (!this.storageKey) return undefined
    try { const s = localStorage.getItem(this.storageKey); return s ? JSON.parse(s) as Doc : undefined } catch { return undefined }
  }
  #setLive(on: boolean) {
    this.#live = on
    if (on && this.scope) (this.#orch ??= Orchestrators.create(this.scope, [], 'connection-designer:orchestrator')).set(this.#doc.intents)
    else this.#orch?.set([])
    this.requestUpdate()
  }

  // ---- drag and drop
  #cellOf(e: DragEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { c: Math.floor((e.clientX - r.left) / CELL_W), r: Math.floor((e.clientY - r.top) / CELL_H) }
  }
  #drop(e: DragEvent) {
    e.preventDefault()
    const d = this.#drag, cell = this.#cellOf(e)
    this.#drag = undefined
    if (!d || cell.c < 0 || cell.r < 0) return this.requestUpdate()
    this.#set(d.kind === 'new'
      ? place(this.#doc, stepFor(d.entry, d.piece), cell, newId())
      : move(this.#doc, d.at.workflow, d.at.index, cell, [newId(), newId()]))
  }
  #dropOnPalette(e: DragEvent) {
    e.preventDefault()
    const d = this.#drag
    this.#drag = undefined
    if (d?.kind === 'move') this.#set(take(this.#doc, d.at.workflow, d.at.index, newId())); else this.requestUpdate()
  }

  // ---- lookups
  /** The palette piece a board step means: its component's entry (by component, or by the named instance). */
  #specOf(p: BoardPiece, entries: PaletteEntry[]) {
    const s = p.step.select
    const entry = s.by === 'component' ? entries.find(e => e.key === componentKey(s.id))
      : s.by === 'name' ? entries.find(e => e.instances.includes(s.name)) : undefined
    return { entry, piece: entry?.pieces.find(x => x.op === p.step.op) }
  }

  override render() {
    if (!this.scope) return html`<p class="muted">Put &lt;connection-designer&gt; inside a scope provider, or set <code>.scope</code>.</p>`
    const entries = palette(this.#instances)
    const result: Plan = plan(this.#doc.intents, this.#instances)
    const names = new Map(entries.flatMap(e => e.pieces.flatMap(p => [p.input, p.output])).filter((x): x is TypeInfo => !!x).map(x => [x.hash, x.name]))
    const fit = this.#drag ? new Set(partners(entries, this.#drag.piece).map(p => `${p.key}|${p.op}`)) : undefined
    return html`
      <aside class="palette" @dragover=${(e: DragEvent) => e.preventDefault()} @drop=${(e: DragEvent) => this.#dropOnPalette(e)}>
        <h3>Components</h3>
        ${entries.length ? nothing : html`<p class="muted">No components in this scope yet.</p>`}
        ${entries.map(e => html`
          <section>
            <h4>${e.key} <small>${e.instances.join(', ')}</small></h4>
            ${e.pieces.map(p => html`
              <div class="piece ${fit?.has(`${e.key}|${p.op}`) ? 'fits' : ''}" draggable="true" title=${p.description ?? p.op}
                @dragstart=${() => { this.#drag = { kind: 'new', entry: e, piece: p }; this.requestUpdate() }}
                @dragend=${() => { this.#drag = undefined; this.requestUpdate() }}>
                ${this.#tile(p, 0.6)}
              </div>`)}
          </section>`)}
      </aside>
      <main class="board" style="width:${COLS * CELL_W + D}px;height:${ROWS * CELL_H}px"
        @dragover=${(e: DragEvent) => e.preventDefault()} @drop=${(e: DragEvent) => this.#drop(e)}>
        ${board(this.#doc).length ? nothing : html`<p class="hint">Drag pieces here. Pieces joined in a row are a workflow.</p>`}
        ${board(this.#doc).map(b => this.#boardPiece(b, entries, result, fit))}
      </main>
      <aside class="side">
        <h3>Intents <label class="live"><input type="checkbox" .checked=${this.#live} @change=${(e: Event) => this.#setLive((e.target as HTMLInputElement).checked)}> Live</label></h3>
        ${this.#doc.intents.map(i => html`
          <div class="intent ${result.status[i.id]?.viable ? 'viable' : 'not'}">
            <label><input type="checkbox" .checked=${i.enabled !== false} @change=${(e: Event) => this.#set(toggle(this.#doc, i.id, (e.target as HTMLInputElement).checked))}>
              <b>${i.kind === 'workflow' ? `workflow ${i.id}` : `connection ${i.id}`}</b></label>
            <button class="x" title="Remove" @click=${() => this.#set(remove(this.#doc, i.id))}>×</button>
            <div class="status">${result.status[i.id]?.viable ? `viable · ${result.status[i.id].routes} route(s)` : 'not viable'}</div>
            ${(result.status[i.id]?.problems ?? []).map(p => html`<div class="problem">${problemText(p, names)}</div>`)}
          </div>`)}
        ${this.#ruleForm(entries)}
        <h3>Document</h3>
        <textarea spellcheck="false" .value=${this.#json || JSON.stringify(this.#doc, null, 2)}
          @input=${(e: Event) => { this.#json = (e.target as HTMLTextAreaElement).value; this.#jsonError = '' }}></textarea>
        <div class="row">
          <button @click=${() => this.#loadJson()}>Load</button>
          <button @click=${() => navigator.clipboard?.writeText(JSON.stringify(this.#doc, null, 2))}>Copy</button>
          <button @click=${() => this.#set(emptyDoc())}>Clear</button>
        </div>
        ${this.#jsonError ? html`<p class="problem">${this.#jsonError}</p>` : nothing}
      </aside>`
  }

  #tile(p: PieceSpec, scale = 1, cls = '') {
    const g = `g-${(p.input?.hash ?? 'none').slice(1, 12)}-${(p.output?.hash ?? 'none').slice(1, 12)}` // same types, same gradient
    return html`<svg class="tile ${cls}" width=${(W + 2 * D) * scale} height=${H * scale} viewBox="${-D} 0 ${W + 2 * D} ${H}" role="img" aria-label=${`${p.label}: ${p.input?.name ?? '—'} → ${p.output?.name ?? '—'}`}>
      <defs><linearGradient id=${g} x1="0" x2="1"><stop offset="0" stop-color=${hue(p.input)}></stop><stop offset="1" stop-color=${hue(p.output)}></stop></linearGradient></defs>
      ${svg`<path d=${tile(p)} fill=${`url(#${g})`} stroke="currentColor" stroke-width="1.2"></path>
        <text x=${W / 2} y="25" text-anchor="middle" class="label">${p.label}</text>
        <text x=${W / 2} y="44" text-anchor="middle" class="types">${p.input?.name ?? ''}${p.input && p.output ? ' → ' : ''}${p.output?.name ?? ''}</text>`}
    </svg>`
  }

  #boardPiece(b: BoardPiece, entries: PaletteEntry[], result: Plan, fit?: Set<string>) {
    const { entry, piece } = this.#specOf(b, entries)
    const wf = workflows(this.#doc).find(w => w.id === b.workflow)!
    const next = wf.steps[b.index + 1] && board(this.#doc).find(x => x.workflow === b.workflow && x.index === b.index + 1)
    const nextSpec = next && this.#specOf(next, entries).piece
    const seam = next ? (joins(piece?.output, nextSpec?.input) ? 'ok' : 'mismatch') : undefined
    const status = result.status[b.workflow]
    const ambiguous = status?.problems.find(p => p.kind === 'ambiguous' && p.at === `step ${b.index}`) as Extract<Problem, { kind: 'ambiguous' }> | undefined
    const pos = `left:${b.cell.c * CELL_W}px;top:${b.cell.r * CELL_H}px`
    if (!piece || !entry) return html`<div class="placed missing" style=${pos} draggable="true"
      @dragstart=${() => { this.#drag = { kind: 'move', at: b, piece: { op: b.step.op, label: b.step.op.split('/').pop()!, role: 'action' } } }}>
      <b>${b.step.op.split('/').pop()}</b><small>no such component here</small></div>`
    return html`
      <div class="placed ${status?.viable ? 'viable' : ''} ${fit?.has(`${entry.key}|${piece.op}`) ? 'fits' : ''}" style=${pos} draggable="true"
        @dragstart=${() => { this.#drag = { kind: 'move', at: b, piece }; this.requestUpdate() }}
        @dragend=${() => { this.#drag = undefined; this.requestUpdate() }}>
        ${this.#tile(piece)}
        <div class="who">
          ${ambiguous || b.step.select.by === 'name'
            ? html`<select @change=${(e: Event) => this.#pin(b, (e.target as HTMLSelectElement).value, entry)}>
                <option value="" ?selected=${b.step.select.by !== 'name'}>any ${entry.key}</option>
                ${entry.instances.map(n => html`<option value=${n} ?selected=${b.step.select.by === 'name' && b.step.select.name === n}>${n}</option>`)}
              </select>`
            : html`<small>${entry.key}</small>`}
        </div>
        ${seam ? html`<span class="seam ${seam}" title=${seam === 'ok' ? 'fits' : 'types do not fit'}>${seam === 'ok' ? '✓' : '✕'}</span>` : nothing}
      </div>`
  }

  #pin(b: BoardPiece, name: string, entry: PaletteEntry) {
    const select: InstanceSel = name ? { by: 'name', name } : { by: 'component', id: entry.component }
    this.#set(pin(this.#doc, b.workflow, b.index, select))
  }

  // ---- fan-out connection rules
  #rule = { from: 'any', to: '', op: '' }
  #ruleForm(entries: PaletteEntry[]) {
    const sinks = entries.flatMap(e => e.pieces.filter(p => p.input).map(p => ({ e, p })))
    const pick = sinks.find(s => `${s.e.key}|${s.p.op}` === `${this.#rule.to}|${this.#rule.op}`) ?? sinks[0]
    const add = () => {
      if (!pick) return
      const from: InstanceSel = this.#rule.from === 'any' ? { by: 'any' } : { by: 'component', id: entries.find(e => e.key === this.#rule.from)!.component }
      const c: Connection = { kind: 'connection', id: newId(), from: { select: from, output: { by: 'outputs' } }, to: { select: { by: 'component', id: pick.e.component }, op: pick.p.op } }
      this.#set(addConnection(this.#doc, c))
    }
    return html`
      <details class="rule">
        <summary>+ Connection (fan-out)</summary>
        <label>every output of
          <select @change=${(e: Event) => { this.#rule.from = (e.target as HTMLSelectElement).value }}>
            <option value="any">any component</option>
            ${entries.map(e => html`<option value=${e.key}>${e.key}</option>`)}
          </select></label>
        <label>into
          <select @change=${(e: Event) => { const [to, op] = (e.target as HTMLSelectElement).value.split('|'); this.#rule.to = to; this.#rule.op = op }}>
            ${sinks.map(s => html`<option value=${`${s.e.key}|${s.p.op}`}>${s.e.key} · ${s.p.label}${s.p.input?.any ? ' (any)' : ''}</option>`)}
          </select></label>
        <button ?disabled=${!pick} @click=${add}>Add</button>
        <p class="muted">Outputs whose type does not fit are skipped.</p>
      </details>`
  }

  #loadJson() {
    try {
      const d = JSON.parse(this.#json || '{}')
      if (!Array.isArray(d.intents) || typeof d.layout !== 'object') throw new Error('expected { "intents": [...], "layout": {...} }')
      this.#set({ intents: d.intents, layout: d.layout ?? {} })
    } catch (e: any) { this.#jsonError = String(e?.message ?? e); this.requestUpdate() }
  }

  static styles = [base, css`
    :host { display: grid; grid-template-columns: minmax(180px, 220px) minmax(0, 1fr) minmax(220px, 280px); gap: ${t.gap}; min-height: 420px; }
    h3 { font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; color: ${t.muted}; margin: 0 0 6px; display: flex; justify-content: space-between; }
    h4 { margin: 8px 0 4px; font-size: .85rem; } h4 small { color: ${t.muted}; font-weight: 400; }
    .muted, .hint { color: ${t.muted}; font-size: .85rem; }
    aside { overflow: auto; min-width: 0; }
    .palette .piece { cursor: grab; border-radius: ${t.radius}; padding: 2px; }
    .fits { outline: 2px solid ${t.accent}; outline-offset: 2px; border-radius: ${t.radius}; }
    .board { position: relative; background-image: radial-gradient(${t.line} 1px, transparent 1px); background-size: ${CELL_W}px ${CELL_H}px;
      overflow: auto; max-width: 100%; border: 1px solid ${t.line}; border-radius: ${t.radius}; }
    .board .hint { position: absolute; inset: 40% 0 auto; text-align: center; }
    .placed { position: absolute; width: ${W}px; cursor: grab; }
    .placed .tile { margin-left: -${D}px; display: block; }
    .placed.viable .tile path { stroke: ${t.accent}; stroke-width: 2; }
    .placed .who { font-size: 11px; padding-left: 4px; } .placed .who select { font-size: 11px; padding: 1px 2px; max-width: ${W - 8}px; }
    .placed.missing { height: ${H}px; border: 1px dashed ${t.danger}; border-radius: ${t.radius}; padding: 4px 8px; display: grid; }
    .seam { position: absolute; right: -8px; top: ${H / 2 - 9}px; width: 16px; height: 16px; border-radius: 50%; font-size: 11px; line-height: 16px; text-align: center; z-index: 1; }
    .seam.ok { background: ${t.accent}; color: ${t['accent-fg']}; } .seam.mismatch { background: ${t.danger}; color: white; }
    .tile .label { font: 600 12px ${t.font}; fill: #111; } .tile .types { font: 10px ${t.mono}; fill: #222; }
    .intent { border: 1px solid ${t.line}; border-left: 3px solid ${t.danger}; border-radius: ${t.radius}; padding: 4px 6px; margin-bottom: 6px; position: relative; font-size: .85rem; }
    .intent.viable { border-left-color: ${t.accent}; }
    .intent .x { position: absolute; right: 4px; top: 2px; padding: 0 6px; background: transparent; color: ${t.muted}; }
    .status { color: ${t.muted}; } .problem { color: ${t.danger}; font-size: .8rem; }
    .live { font-size: .75rem; text-transform: none; letter-spacing: 0; color: ${t.fg}; }
    textarea { width: 100%; min-height: 160px; font: 11px/1.4 ${t.mono}; background: ${t.surface}; color: ${t.fg}; border: 1px solid ${t.line}; border-radius: ${t.radius}; box-sizing: border-box; }
    .row { display: flex; gap: 6px; margin-top: 4px; }
    .rule { margin: 8px 0; font-size: .85rem; } .rule label { display: block; margin: 4px 0; } .rule select { max-width: 100%; }
  `]
}

/** Register as `<${tag}>` (default `connection-designer`); a no-op if taken. */
export const defineDesigner = (tag = 'connection-designer') => { if (!customElements.get(tag)) customElements.define(tag, ConnectionDesigner) }
