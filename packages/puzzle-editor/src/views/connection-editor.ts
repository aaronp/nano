/**
 * <connection-editor>: the board view of a connection-editor component. A palette of its components' ops (pieces),
 * a board where pieces in a row are a workflow, the intents with their status, a fan-out rule form and the Live
 * switch. It reads the component's state and acts only by calling its ops.
 */
import { css, html, nothing } from 'lit'
import { live } from 'lit/directives/live.js'
import type { TSchema } from 'typebox'
import type { Created, Input, Instance, Op, Result } from '@composable/sdk'
import type { Connection, InstanceSel, Problem } from '@composable/connections'
import { View, base, t } from '@composable/ui'
import { PRESETS, lookOf, board as bm, type Look } from '../model'
import { ConnectionEditorOps as O, connectionEditor } from '../components'
import { CELL, PAD, tilePath, type SideKind } from './tiles'
const { board, componentKey, joins, palette, partners, workflows } = bm
type BoardPiece = bm.BoardPiece; type PaletteEntry = bm.PaletteEntry; type PieceSpec = bm.PieceSpec; type TypeInfo = bm.TypeInfo

const COLS = 8, ROWS = 6, FULL = CELL + 2 * PAD
let seq = 0
const newId = () => `r${(++seq).toString(36)}${Date.now().toString(36).slice(-3)}`

const problemText = (p: Problem, names: Map<string, string>): string =>
  p.kind === 'no-match' ? `nothing matches ${p.at}`
    : p.kind === 'ambiguous' ? `${p.at} matches ${p.instances.join(', ')}: pin one`
      : p.kind === 'no-op' ? `${p.at} has no ${p.op.split('/').pop()}`
        : p.kind === 'type-mismatch' ? `${p.at}: ${names.get(p.output) ?? p.output.slice(0, 8)} does not fit ${names.get(p.input) ?? p.input.slice(0, 8)}`
          : p.kind === 'unavailable' ? `${p.at} needs ${p.needs.join(', ')}, which nothing here provides`
            : (() => { throw new Error(`unknown problem ${JSON.stringify(p)}`) })()

type Drag = { kind: 'new'; entry: PaletteEntry; piece: PieceSpec } | { kind: 'move'; at: BoardPiece; piece: PieceSpec }

export class ConnectionEditorView extends View<Created<typeof connectionEditor>> {
  static factory = connectionEditor
  #drag?: Drag
  #error = ''
  #rule = { from: 'any', to: '' }

  /** Call one of the component's own ops through its handle; a failed Result shows as text. */
  async #act<P extends Op<TSchema, TSchema | undefined>>(op: P, input: Input<P>) {
    const h = this.component.systems[0]
    let r: Result<unknown>
    try { r = h ? await h.call(h.instanceId, op, input) : { type: 'error', error: { code: 'unavailable', message: 'not in a System' } } }
    catch (e) { r = { type: 'error', error: { code: 'handler', message: String((e as Error)?.message ?? e) } } }
    this.#error = r.type === 'success' ? '' : r.type === 'error' ? r.error.message : r.reason
    this.requestUpdate()
  }

  #look(ty: TypeInfo): Look { return this.component.state.looks?.derived.find(d => d.said === ty.hash)?.look ?? lookOf(ty.hash) }

  /** Palette entries: the live instances' components, plus draft components nothing implements yet. */
  #entries(): PaletteEntry[] {
    const { instances, components } = this.component.state
    const drafts: Instance[] = components.filter(c => c.draft && !c.implemented).map(c => ({ id: componentKey(c.manifest.id), manifest: c.manifest }))
    return palette([...instances, ...drafts])
  }

  #cellOf(e: DragEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { c: Math.floor((e.clientX - r.left) / CELL), r: Math.floor((e.clientY - r.top) / CELL) }
  }
  #drop(e: DragEvent) {
    e.preventDefault()
    const d = this.#drag, cell = this.#cellOf(e)
    this.#drag = undefined
    if (!d || cell.c < 0 || cell.r < 0) return this.requestUpdate()
    if (d.kind === 'new') void this.#act(O.place, { component: d.entry.component, op: d.piece.op, cell })
    else void this.#act(O.move, { workflow: d.at.workflow, index: d.at.index, cell })
  }
  #dropOnPalette(e: DragEvent) {
    e.preventDefault()
    const d = this.#drag
    this.#drag = undefined
    if (d?.kind === 'move') void this.#act(O.take, { workflow: d.at.workflow, index: d.at.index }); else this.requestUpdate()
  }
  #specOf(p: BoardPiece, entries: PaletteEntry[]) {
    const s = p.step.select
    const entry = s.by === 'component' ? entries.find(e => e.key === componentKey(s.id))
      : s.by === 'name' ? entries.find(e => e.instances.includes(s.name)) : undefined
    return { entry, piece: entry?.pieces.find(x => x.op === p.step.op) }
  }

  override render() {
    const { connections, status, live: liveOn } = this.component.state
    const entries = this.#entries()
    const names = new Map(entries.flatMap(e => e.pieces.flatMap(p => [p.input, p.output])).filter((x): x is TypeInfo => !!x).map(x => [x.hash, x.name]))
    const fit = this.#drag ? new Set(partners(entries, this.#drag.piece).map(p => `${p.key}|${p.op}`)) : undefined
    const placed = board(connections)
    return html`
      <aside class="palette" @dragover=${(e: DragEvent) => e.preventDefault()} @drop=${(e: DragEvent) => this.#dropOnPalette(e)}>
        <h3>Components</h3>
        ${entries.length ? nothing : html`<p class="muted">No components in this System yet.</p>`}
        ${entries.map(e => html`
          <section>
            <h4>${e.key} <small>${e.instances.join(', ')}</small></h4>
            ${e.pieces.map(p => html`
              <div class="piece ${fit?.has(`${e.key}|${p.op}`) ? 'fits' : ''}" draggable="true" title=${p.description ?? p.op}
                @dragstart=${() => { this.#drag = { kind: 'new', entry: e, piece: p }; this.requestUpdate() }}
                @dragend=${() => { this.#drag = undefined; this.requestUpdate() }}>
                ${this.#tile(p, 0.5)}
              </div>`)}
          </section>`)}
      </aside>
      <main class="board" style="width:${COLS * CELL}px;height:${ROWS * CELL}px"
        @dragover=${(e: DragEvent) => e.preventDefault()} @drop=${(e: DragEvent) => this.#drop(e)}>
        ${placed.length ? nothing : html`<p class="hint">Drag pieces here. Pieces joined in a row are a workflow.</p>`}
        ${placed.map(b => this.#boardPiece(b, entries, fit))}
      </main>
      <aside class="side">
        <h3>Intents <label class="live"><input type="checkbox" .checked=${live(liveOn)} @change=${(e: Event) => void this.#act(O.setLive, (e.target as HTMLInputElement).checked)}> Live</label></h3>
        ${this.#error ? html`<p class="problem error">${this.#error}</p>` : nothing}
        ${connections.intents.map(i => html`
          <div class="intent ${status[i.id]?.viable ? 'viable' : 'not'}" data-intent=${i.id}>
            <label><input type="checkbox" .checked=${live(i.enabled !== false)} @change=${(e: Event) => void this.#act(O.toggle, { id: i.id, enabled: (e.target as HTMLInputElement).checked })}>
              <b>${i.kind === 'workflow' ? `workflow ${i.id}` : `connection ${i.id}`}</b></label>
            <button class="x" title="Remove" @click=${() => void this.#act(O.remove, { id: i.id })}>×</button>
            <div class="status">${status[i.id]?.viable ? `viable · ${status[i.id]!.routes} route(s)` : 'not viable'}</div>
            ${(status[i.id]?.problems ?? []).map(p => html`<div class="problem">${problemText(p, names)}</div>`)}
          </div>`)}
        ${this.#ruleForm(entries)}
      </aside>`
  }

  #tile(p: PieceSpec, scale = 1) {
    const side = (ty: TypeInfo | undefined, kind: SideKind) => ty ? kind : 'flat' as SideKind
    const shapeOf = (ty: TypeInfo | undefined) => ty && (ty.any ? PRESETS.square : this.#look(ty).shape)
    const d = tilePath({ T: 'flat', B: 'flat', R: side(p.output, 'knob'), L: side(p.input, 'hole') }, { R: shapeOf(p.output), L: shapeOf(p.input) })
    const colour = (ty?: TypeInfo) => ty && !ty.any ? this.#look(ty).colour : 'var(--c-surface, #f5f5f4)'
    const g = `g-${(p.input?.hash ?? 'none').slice(1, 12)}-${(p.output?.hash ?? 'none').slice(1, 12)}`
    return html`<svg class="tile" width=${FULL * scale} height=${FULL * scale} viewBox="0 0 ${FULL} ${FULL}" role="img" aria-label=${`${p.label}: ${p.input?.name ?? '—'} → ${p.output?.name ?? '—'}`}>
      <defs><linearGradient id=${g} x1="0" x2="1"><stop offset="0" stop-color=${colour(p.input)}></stop><stop offset="1" stop-color=${colour(p.output)}></stop></linearGradient></defs>
      <path d=${d} fill=${`url(#${g})`} stroke="currentColor" stroke-width="2"></path>
      <text x=${FULL / 2} y=${FULL / 2 - 4} text-anchor="middle" class="label">${p.label}</text>
      <text x=${FULL / 2} y=${FULL / 2 + 16} text-anchor="middle" class="types">${p.input?.name ?? ''}${p.input && p.output ? ' → ' : ''}${p.output?.name ?? ''}</text>
    </svg>`
  }

  #boardPiece(b: BoardPiece, entries: PaletteEntry[], fit?: Set<string>) {
    const { connections, status: all } = this.component.state
    const { entry, piece } = this.#specOf(b, entries)
    const wf = workflows(connections).find(w => w.id === b.workflow)!
    const next = wf.steps[b.index + 1] && board(connections).find(x => x.workflow === b.workflow && x.index === b.index + 1)
    const nextSpec = next && this.#specOf(next, entries).piece
    const seam = next ? (joins(piece?.output, nextSpec?.input) ? 'ok' : 'mismatch') : undefined
    const status = all[b.workflow]
    const ambiguous = status?.problems.some(p => p.kind === 'ambiguous' && p.at === `step ${b.index}`)
    const pos = `left:${b.cell.c * CELL}px;top:${b.cell.r * CELL}px`
    if (!piece || !entry) return html`<div class="placed missing" style=${pos} draggable="true"
      @dragstart=${() => { this.#drag = { kind: 'move', at: b, piece: { op: b.step.op, label: b.step.op.split('/').pop()!, role: 'action' } } }}>
      <b>${b.step.op.split('/').pop()}</b><small>no such component here</small></div>`
    const pin = (name: string) => {
      const select: InstanceSel = name ? { by: 'name', name } : { by: 'component', id: entry.component }
      void this.#act(O.pin, { workflow: b.workflow, index: b.index, select })
    }
    return html`
      <div class="placed ${status?.viable ? 'viable' : ''} ${fit?.has(`${entry.key}|${piece.op}`) ? 'fits' : ''}" style=${pos} draggable="true"
        @dragstart=${() => { this.#drag = { kind: 'move', at: b, piece }; this.requestUpdate() }}
        @dragend=${() => { this.#drag = undefined; this.requestUpdate() }}>
        ${this.#tile(piece)}
        <div class="who">
          ${ambiguous || b.step.select.by === 'name'
            ? html`<select @change=${(e: Event) => pin((e.target as HTMLSelectElement).value)}>
                <option value="" ?selected=${b.step.select.by !== 'name'}>any ${entry.key}</option>
                ${entry.instances.map(n => html`<option value=${n} ?selected=${b.step.select.by === 'name' && b.step.select.name === n}>${n}</option>`)}
              </select>`
            : html`<small>${entry.key}</small>`}
        </div>
        ${seam ? html`<span class="seam ${seam}" title=${seam === 'ok' ? 'fits' : 'types do not fit'}>${seam === 'ok' ? '✓' : '✕'}</span>` : nothing}
      </div>`
  }

  #ruleForm(entries: PaletteEntry[]) {
    const sinks = entries.flatMap(e => e.pieces.filter(p => p.input).map(p => ({ e, p })))
    const pick = sinks.find(s => `${s.e.key}|${s.p.op}` === this.#rule.to) ?? sinks[0]
    const add = () => {
      if (!pick) return
      const from: InstanceSel = this.#rule.from === 'any' ? { by: 'any' } : { by: 'component', id: entries.find(e => e.key === this.#rule.from)!.component }
      const connection: Connection = { kind: 'connection', id: newId(), from: { select: from, output: { by: 'outputs' } }, to: { select: { by: 'component', id: pick.e.component }, op: pick.p.op } }
      void this.#act(O.addRule, { connection })
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
          <select @change=${(e: Event) => { this.#rule.to = (e.target as HTMLSelectElement).value }}>
            ${sinks.map(s => html`<option value=${`${s.e.key}|${s.p.op}`}>${s.e.key} · ${s.p.label}${s.p.input?.any ? ' (any)' : ''}</option>`)}
          </select></label>
        <button class="add-rule" ?disabled=${!pick} @click=${add}>Add</button>
        <p class="muted">Outputs whose type does not fit are skipped.</p>
      </details>`
  }

  static styles = [base, css`
    :host { display: grid; grid-template-columns: minmax(150px, 200px) minmax(0, 1fr) minmax(220px, 280px); gap: ${t.gap}; min-height: 420px; }
    h3 { font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; color: ${t.muted}; margin: 0 0 6px; display: flex; justify-content: space-between; }
    h4 { margin: 8px 0 4px; font-size: .85rem; } h4 small { color: ${t.muted}; font-weight: 400; }
    .muted, .hint { color: ${t.muted}; font-size: .85rem; }
    aside { overflow: auto; min-width: 0; }
    .palette .piece { cursor: grab; border-radius: ${t.radius}; margin-bottom: -${PAD / 2}px; }
    .tile { display: block; color: ${t.fg}; }
    .fits { outline: 2px solid ${t.accent}; outline-offset: 2px; border-radius: ${t.radius}; }
    .board { position: relative; background-image: radial-gradient(${t.line} 1px, transparent 1px); background-size: ${CELL}px ${CELL}px;
      overflow: auto; max-width: 100%; border: 1px solid ${t.line}; border-radius: ${t.radius}; }
    .board .hint { position: absolute; inset: 40% 0 auto; text-align: center; }
    .placed { position: absolute; width: ${CELL}px; height: ${CELL}px; cursor: grab; }
    .placed .tile { margin: -${PAD}px 0 0 -${PAD}px; }
    .placed.viable .tile path { stroke: ${t.accent}; stroke-width: 3; }
    .placed .who { position: absolute; left: 4px; bottom: 2px; font-size: 11px; } .placed .who select { font-size: 11px; padding: 1px 2px; max-width: ${CELL - 8}px; }
    .placed.missing { border: 1px dashed ${t.danger}; border-radius: ${t.radius}; padding: 4px 8px; box-sizing: border-box; display: grid; }
    .seam { position: absolute; right: -8px; top: ${CELL / 2 - 9}px; width: 16px; height: 16px; border-radius: 50%; font-size: 11px; line-height: 16px; text-align: center; z-index: 1; }
    .seam.ok { background: ${t.accent}; color: ${t['accent-fg']}; } .seam.mismatch { background: ${t.danger}; color: white; }
    .tile .label { font: 600 14px ${t.font}; fill: #111; } .tile .types { font: 11px ${t.mono}; fill: #222; }
    .intent { border: 1px solid ${t.line}; border-left: 3px solid ${t.danger}; border-radius: ${t.radius}; padding: 4px 6px; margin-bottom: 6px; position: relative; font-size: .85rem; }
    .intent.viable { border-left-color: ${t.accent}; }
    .intent .x { position: absolute; right: 4px; top: 2px; padding: 0 6px; background: transparent; color: ${t.muted}; }
    .status { color: ${t.muted}; } .problem { color: ${t.danger}; font-size: .8rem; }
    .live { font-size: .75rem; text-transform: none; letter-spacing: 0; color: ${t.fg}; }
    .rule { margin: 8px 0; font-size: .85rem; } .rule label { display: block; margin: 4px 0; } .rule select { max-width: 100%; }
  `]
}

/** Register as `<${tag}>` (default `connection-editor`); a no-op if taken. */
export const defineConnectionEditor = (tag = 'connection-editor') => { if (!customElements.get(tag)) customElements.define(tag, ConnectionEditorView) }
