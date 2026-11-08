/**
 * <type-editor>: the Types tab of a type-editor component. A List/Code toggle, record and brand rows, and the shape
 * editor dialog. It reads the component's state; it acts only by calling the component's ops.
 */
import { css, html, nothing } from 'lit'
import { live } from 'lit/directives/live.js'
import type { TSchema } from 'typebox'
import type { Created, Input, Op, Result } from '@composable/sdk'
import { View, base, t } from '@composable/ui'
import {
  PRESETS, PRESET_LABELS, PRESET_ORDER, SWATCHES, effectiveLook, movePoint, nameOf, presetShape, removeAnchor, saidOf, splitSegment,
  type EditorType, type Handle, type Look,
} from '../model'
import { printTypes } from '../model/typescript'
import { TypeEditorOps as O, typeEditor } from '../components'
import { iconFor, presetIcon } from './tiles'

type Pt = [number, number]
// The shape editor canvas: shape coordinates (u along the edge, v out of it) map to the canvas as in the prototype.
const W = 420, H = 400, EDGE_X = 200, EDGE_Y = 20, K = 3
const toCanvas = ([u, v]: Pt): Pt => [EDGE_X + v * K, EDGE_Y + u * K]
const f1 = (n: number) => Math.round(n * 10) / 10
const fmt = (p: Pt) => `${f1(p[0])} ${f1(p[1])}`
const PATTERNS: [Look['pattern'], string][] = [['none', 'None'], ['diagonal', 'Diagonal /'], ['anti-diagonal', 'Diagonal \\'], ['vertical', 'Vertical'], ['horizontal', 'Horizontal'], ['dots', 'Dots']]
const patFill = (p: Look['pattern']) => p === 'none' ? 'none' : `url(#pat-${p})`
const anchorOf = (s: Look['shape'], k: number): Pt => k === 0 ? s.start : s.segs[k - 1]!.p

export class TypeEditorView extends View<Created<typeof typeEditor>> {
  static factory = typeEditor
  #mode: 'list' | 'code' = 'list'
  #errors: string[] = []
  #code?: string
  #adding?: 'record'
  #name = ''
  #selected?: string
  #field = { name: '', type: 'string', array: false }
  #brand?: string
  #editing?: string
  #anchor?: number
  #drag?: Handle
  #mirror = true
  #message = ''

  /** Call one of the component's own ops through its handle; a failed Result shows as text. True on success. */
  async #act<P extends Op<TSchema, TSchema | undefined>>(op: P, input: Input<P>) {
    const h = this.component.systems[0]
    let r: Result<unknown>
    try { r = h ? await h.call(h.instanceId, op, input) : { type: 'error', error: { code: 'unavailable', message: 'not in a System' } } }
    catch (e) { r = { type: 'error', error: { code: 'handler', message: String((e as Error)?.message ?? e) } } }
    this.#errors = r.type === 'success' ? [] : (r.type === 'error' ? r.error.message : r.reason).split('; ')
    this.requestUpdate()
    return r.type === 'success'
  }

  #look(ty: EditorType): Look {
    const r = saidOf(ty.id, this.component.state.types)
    return effectiveLook(ty, r.type === 'success' ? r.data : '') 
  }
  #setLook(ty: EditorType, patch: Partial<Look>) { return this.#act(O.setLook, { id: ty.id, look: { ...this.#look(ty), ...patch } }) }
  /** Names of the types that refer to `id`. ponytail: draft ops are not visible to a type-editor, so they are not listed. */
  #usedBy(id: string) {
    return this.component.state.types.filter(x => (x.kind === 'record' && x.fields.some(f => f.ref.type === id)) || (x.kind === 'brand' && x.of === id)).map(nameOf)
  }

  async #create() {
    if (await this.#act(O.addRecord, { id: crypto.randomUUID(), name: this.#name })) this.#adding = undefined
  }

  render() {
    const { types } = this.component.state
    const code = this.#code ?? printTypes(types)
    return html`
      <svg width="0" height="0" aria-hidden="true" style="position:absolute">${this.#patterns()}</svg>
      <div class="toggle" role="group" aria-label="Types view">
        <button class="tab-list" aria-pressed=${this.#mode === 'list'} @click=${() => { this.#mode = 'list'; this.#errors = []; this.requestUpdate() }}>List</button>
        <button class="tab-code" aria-pressed=${this.#mode === 'code'} @click=${() => { this.#mode = 'code'; this.#errors = []; this.#code = undefined; this.requestUpdate() }}>Code</button>
      </div>
      ${this.#errors.map(e => html`<div class="problem">${e}</div>`)}
      ${this.#mode === 'code' ? html`
        <div class="code-bar"><button class="revert" @click=${() => { this.#code = undefined; this.#errors = []; this.requestUpdate() }}>Revert</button>
          <button class="apply primary" @click=${async () => { if (await this.#act(O.setCode, { source: this.#code ?? printTypes(this.component.state.types) })) this.#code = undefined }}>Apply</button></div>
        <textarea class="code" aria-label="TypeScript types" spellcheck="false" .value=${live(code)} @input=${(e: Event) => { this.#code = (e.target as HTMLTextAreaElement).value }}></textarea>
        <p class="muted">Fields take a named type, <code>T[]</code> or <code>Array&lt;T&gt;</code>. <code>type X = Y</code> makes X a brand of Y. Removing a type that something uses is refused.</p>`
        : html`
        ${this.#adding ? html`<div class="new-record-form">
            <input type="text" aria-label="New record type name" placeholder="Record type name, e.g. Address" .value=${live(this.#name)} @input=${(e: Event) => { this.#name = (e.target as HTMLInputElement).value }}>
            <button class="primary" @click=${() => void this.#create()}>Create</button>
            <button aria-label="Cancel" @click=${() => { this.#adding = undefined; this.requestUpdate() }}>✕</button></div>`
          : html`<button class="new-record" @click=${() => { this.#adding = 'record'; this.#name = ''; this.#errors = []; this.requestUpdate() }}>+ New record type</button>`}
        ${([['BUILT-IN', (x: EditorType) => x.kind === 'primitive'], ['TYPES', (x: EditorType) => x.kind === 'record' || x.kind === 'brand'], ['LIVE', (x: EditorType) => x.kind === 'live']] as const).map(([title, pred]) => {
          const items = types.filter(pred)
          return items.length ? html`<section class="group"><h4>${title}</h4>${items.map(x => this.#row(x))}</section>` : nothing
        })}
        ${this.#detail()}`}
      ${this.#editing ? this.#shapeEditor() : nothing}`
  }

  #icon(ty: EditorType) {
    const look = this.#look(ty), d = iconFor(look.shape)
    return html`<svg class="icon" width="30" height="26" viewBox="0 0 30 26" aria-hidden="true">
      <path d=${d} fill=${look.colour} stroke="currentColor" stroke-width="0.8"></path><path d=${d} fill=${patFill(look.pattern)} stroke="none"></path></svg>`
  }

  #row(ty: EditorType) {
    const detail = ty.kind === 'record' ? `${ty.fields.length} field${ty.fields.length === 1 ? '' : 's'}` : ty.kind === 'brand' ? `brand of ${this.#nameFor(ty.of)}` : ty.kind
    return html`<div class="type-row ${this.#selected === ty.id ? 'on' : ''}" data-type=${ty.id}>
      <button class="select" @click=${() => { this.#selected = ty.id; this.#brand = undefined; this.#errors = []; this.requestUpdate() }}>
        ${this.#icon(ty)}<span class="who"><span class="name">${nameOf(ty)}</span><span class="detail">${detail}</span></span></button>
      ${ty.kind === 'live' ? nothing : html`<button class="edit-shape" aria-label="Edit shape of ${nameOf(ty)}" @click=${() => { this.#editing = ty.id; this.#anchor = undefined; this.#message = ''; this.requestUpdate() }}>Shape</button>`}
    </div>`
  }

  #nameFor(id: string) { const x = this.component.state.types.find(y => y.id === id); return x ? nameOf(x) : id }

  #detail() {
    const { types } = this.component.state
    const ty = types.find(x => x.id === this.#selected)
    if (!ty) return nothing
    const f = this.#field
    return html`<div class="detail-panel" data-detail=${ty.id}>
      <div class="title"><b>${nameOf(ty)}</b> <small>${ty.kind}</small></div>
      ${ty.kind === 'record' || ty.kind === 'brand' ? html`<label class="rename">Name
        <input type="text" class="rename-input" .value=${live(ty.name)} @change=${(e: Event) => void this.#act(O.rename, { id: ty.id, name: (e.target as HTMLInputElement).value })}></label>` : nothing}
      ${ty.kind === 'record' ? html`<div class="fields">${ty.fields.map(fd => html`
          <div class="field" data-field=${fd.name}><code>${fd.name}</code><span>${this.#nameFor(fd.ref.type)}${fd.ref.array ? '[]' : ''}</span>
            <button class="remove-field" aria-label="Remove ${fd.name}" @click=${() => void this.#act(O.removeField, { record: ty.id, name: fd.name })}>✕</button></div>`)}
        <div class="add-field">
          <input type="text" class="field-name" aria-label="Field name" placeholder="field" .value=${live(f.name)} @input=${(e: Event) => { f.name = (e.target as HTMLInputElement).value }}>
          <select class="field-type" aria-label="Field type" @change=${(e: Event) => { f.type = (e.target as HTMLSelectElement).value }}>
            ${types.map(x => html`<option value=${x.id} ?selected=${x.id === f.type}>${nameOf(x)}</option>`)}</select>
          <label><input type="checkbox" class="field-array" .checked=${live(f.array)} @change=${(e: Event) => { f.array = (e.target as HTMLInputElement).checked }}> []</label>
          <button class="add-field-btn" @click=${async () => { if (await this.#act(O.addField, { record: ty.id, name: f.name, ref: { type: f.type, array: f.array } })) f.name = '' }}>+ Field</button></div></div>` : nothing}
      ${ty.kind === 'brand' ? html`<p class="muted">Brand of <b>${this.#nameFor(ty.of)}</b>. Same data, but only joins with itself.</p>` : nothing}
      ${this.#brand === undefined ? nothing : html`<div class="brand-form">
        <input type="text" class="brand-name" aria-label="Brand name" placeholder="Brand name, e.g. Email" .value=${live(this.#brand)} @input=${(e: Event) => { this.#brand = (e.target as HTMLInputElement).value }}>
        <button class="brand-save primary" @click=${async () => { if (await this.#act(O.addBrand, { id: crypto.randomUUID(), name: this.#brand ?? '', of: ty.id })) this.#brand = undefined }}>Copy</button></div>`}
      <div class="actions"><button class="copy-brand" @click=${() => { this.#brand = ''; this.requestUpdate() }}>Copy as brand</button>
        ${ty.kind === 'record' || ty.kind === 'brand' ? html`<button class="delete danger" @click=${async () => { if (await this.#act(O.remove, { id: ty.id })) this.#selected = undefined }}>Delete</button>` : nothing}</div>
    </div>`
  }

  #patterns() {
    const stripe = (id: string, rotate: number, w: number, h: number) => html`<pattern id=${`pat-${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform=${`rotate(${rotate})`}><rect width=${w} height=${h} fill="#0D0F13" fill-opacity="0.6"></rect></pattern>`
    return html`<defs>${stripe('diagonal', 45, 2.2, 6)}${stripe('anti-diagonal', -45, 2.2, 6)}${stripe('vertical', 0, 2.2, 6)}${stripe('horizontal', 0, 6, 2.2)}
      <pattern id="pat-dots" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.4" fill="#0D0F13" fill-opacity="0.7"></circle></pattern></defs>`
  }

  // ---- the shape editor
  #pointer(e: PointerEvent): Pt {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return [(e.clientY - r.top - EDGE_Y) / K, (e.clientX - r.left - EDGE_X) / K]
  }
  #move(e: PointerEvent, ty: EditorType) {
    if (!this.#drag) return
    const look = this.#look(ty)
    void this.#setLook(ty, { shape: movePoint(look.shape, this.#drag, this.#pointer(e), this.#mirror) })
  }
  #addPoint(ty: EditorType) {
    const s = this.#look(ty).shape, n = s.segs.length
    const si = this.#anchor === undefined ? Math.floor(n / 2) : Math.min(this.#anchor, n - 1)
    this.#anchor = si + 1; this.#message = ''
    void this.#setLook(ty, { shape: splitSegment(s, si) })
  }
  #removePoint(ty: EditorType) {
    const s = this.#look(ty).shape, k = this.#anchor
    if (k === undefined || k < 1 || k > s.segs.length - 1) { this.#message = 'Select a middle point first. The two end points sit on the edge and stay.'; return this.requestUpdate() }
    this.#anchor = undefined; this.#message = ''
    void this.#setLook(ty, { shape: removeAnchor(s, k) })
  }

  #shapeEditor() {
    const ty = this.component.state.types.find(x => x.id === this.#editing)
    if (!ty) return nothing
    const look = this.#look(ty), s = look.shape, n = s.segs.length
    const seg = `${s.segs.map(g => `C ${fmt(toCanvas(g.c1))} ${fmt(toCanvas(g.c2))} ${fmt(toCanvas(g.p))}`).join(' ')}`
    const knob = `M ${fmt(toCanvas(s.start))} ${seg} Z`
    const body = `M 40 ${EDGE_Y} L ${EDGE_X} ${EDGE_Y} L ${fmt(toCanvas(s.start))} ${seg} L ${EDGE_X} ${H - EDGE_Y} L 40 ${H - EDGE_Y} Z`
    const lines = s.segs.map((g, i) => `M ${fmt(toCanvas(anchorOf(s, i)))} L ${fmt(toCanvas(g.c1))} M ${fmt(toCanvas(g.p))} L ${fmt(toCanvas(g.c2))}`).join(' ')
    const handle = (kind: Handle['kind'], index: number, p: Pt, size: number, cls: string, label: string) => {
      const [x, y] = toCanvas(p)
      return html`<div class="handle ${cls}" aria-label=${label} style="left:${f1(x - size / 2 - 1)}px;top:${f1(y - size / 2 - 1)}px;width:${size}px;height:${size}px"
        @pointerdown=${(e: PointerEvent) => {
          e.preventDefault(); e.stopPropagation()
          try { (e.target as Element).setPointerCapture?.(e.pointerId) } catch { /* no capture: moves still reach the canvas */ }
          this.#drag = { kind, index }; this.#message = ''
          if (kind === 'anchor') this.#anchor = index
          this.requestUpdate()
        }}></div>`
    }
    const used = this.#usedBy(ty.id)
    const btn = (on: boolean) => on ? 'on' : ''
    return html`<div class="shape-editor" role="dialog" aria-label="Edit shape of ${nameOf(ty)}">
      <div class="panel">
        <div class="canvas-col">
          <div class="head"><b>${nameOf(ty)}</b> <small>edge shape</small></div>
          <div class="canvas" style="width:${W}px;height:${H}px" @pointermove=${(e: PointerEvent) => this.#move(e, ty)}
            @pointerup=${() => { this.#drag = undefined }} @pointerleave=${() => { this.#drag = undefined }}>
            <svg width=${W} height=${H} viewBox="0 0 ${W} ${H}" aria-hidden="true">
              <path d="M ${EDGE_X} ${EDGE_Y} L ${EDGE_X} ${H - EDGE_Y}" stroke=${t.line} stroke-dasharray="4 4"></path>
              <path d=${body} fill=${t.surface} stroke=${t.muted} stroke-width="2"></path>
              <path d=${knob} fill=${look.colour} stroke=${t.muted} stroke-width="2"></path>
              <path d=${knob} fill=${patFill(look.pattern)} stroke="none"></path>
              <path d=${lines} fill="none" stroke=${t.accent} stroke-width="1.2"></path>
            </svg>
            ${s.segs.flatMap((g, i) => [handle('c1', i, g.c1, 10, 'curve', 'Curve handle'), handle('c2', i, g.c2, 10, 'curve', 'Curve handle')])}
            ${Array.from({ length: n + 1 }, (_, k) => handle('anchor', k, anchorOf(s, k), 13, `point ${k === 0 || k === n ? 'end' : ''} ${this.#anchor === k ? 'sel' : ''}`, k === 0 || k === n ? 'End point' : 'Point'))}
          </div>
          <p class="muted">Drag the square points to move the outline; drag the round handles to bend the curves. The two end points stay on the edge and slide along it.</p>
        </div>
        <div class="controls">
          <div class="right"><button class="done primary" @click=${() => { this.#editing = undefined; this.#drag = undefined; this.requestUpdate() }}>Done</button></div>
          <h4>STARTING SHAPES</h4>
          <div class="presets">${PRESET_ORDER.map(id => html`
            <button class="preset ${btn(JSON.stringify(s) === JSON.stringify(PRESETS[id]))}" data-preset=${id} aria-label=${PRESET_LABELS[id]}
              @click=${() => { this.#anchor = undefined; this.#message = ''; void this.#setLook(ty, { shape: presetShape(id) }) }}>
              <svg width="40" height="30" viewBox="0 0 40 30" aria-hidden="true"><path d=${presetIcon(PRESETS[id])} fill=${look.colour} stroke=${t.muted}></path></svg><span>${PRESET_LABELS[id]}</span></button>`)}</div>
          <h4>COLOUR</h4>
          <div class="swatches">${SWATCHES.map(c => html`
            <button class="swatch ${btn(c === look.colour)}" data-colour=${c} aria-label="Colour ${c}" style="background:${c}" @click=${() => void this.#setLook(ty, { colour: c })}></button>`)}</div>
          <h4>PATTERN · marks a brand</h4>
          <div class="patterns">${PATTERNS.map(([id, label]) => html`
            <button class="pattern ${btn(id === look.pattern)}" data-pattern=${id} @click=${() => void this.#setLook(ty, { pattern: id })}>${label}</button>`)}</div>
          <h4>POINTS · ${n + 1} points${this.#anchor === undefined ? '' : ` · point ${this.#anchor + 1} selected`}</h4>
          <div class="points">
            <button class="add-point" @click=${() => this.#addPoint(ty)}>Add point</button>
            <button class="remove-point" @click=${() => this.#removePoint(ty)}>Remove point</button>
            <label class="mirror"><input type="checkbox" .checked=${live(this.#mirror)} @change=${(e: Event) => { this.#mirror = (e.target as HTMLInputElement).checked }}> Mirror handles</label></div>
          ${this.#message ? html`<p class="warn">${this.#message}</p>` : nothing}
          ${this.#errors.map(e => html`<div class="problem">${e}</div>`)}
          <p class="used-by muted">${used.length ? `Used by ${used.join(', ')}.` : 'Not used yet.'}</p>
        </div>
      </div>
    </div>`
  }

  static styles = [base, css`
    :host { display: grid; gap: ${t.gap}; align-content: start; }
    button { cursor: pointer; } .primary { background: ${t.accent}; color: ${t['accent-fg']}; border-color: transparent; font-weight: 600; }
    .danger { color: ${t.danger}; }
    .toggle { display: flex; gap: 4px; border: 1px solid ${t.line}; border-radius: ${t.radius}; padding: 3px; }
    .toggle button { flex: 1; border: 0; background: transparent; color: ${t.fg}; padding: 6px 0; border-radius: ${t.radius}; }
    .toggle button[aria-pressed=true] { background: ${t.surface}; font-weight: 600; }
    .new-record { border-style: dashed; height: 34px; font-weight: 600; }
    .new-record-form, .brand-form, .code-bar { display: flex; gap: 6px; } .code-bar { justify-content: flex-end; }
    .new-record-form input, .brand-form input { flex: 1; min-width: 0; font-family: ${t.mono}; }
    textarea.code { width: 100%; box-sizing: border-box; min-height: 260px; font: 13px/20px ${t.mono}; background: ${t.surface}; color: ${t.fg}; border: 1px solid ${t.line}; border-radius: ${t.radius}; padding: 10px; resize: vertical; tab-size: 2; }
    h4 { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .08em; color: ${t.muted}; padding: 6px 0; }
    .group { display: flex; flex-direction: column; gap: 2px; }
    .type-row { display: flex; gap: 4px; align-items: stretch; border: 1px solid transparent; border-radius: ${t.radius}; }
    .type-row.on { background: ${t.surface}; border-color: ${t.line}; }
    .type-row .select { flex: 1; display: flex; align-items: center; gap: 10px; text-align: left; border: 0; background: transparent; color: ${t.fg}; padding: 6px 8px; }
    .icon { color: ${t.muted}; flex: none; } .who { display: flex; flex-direction: column; }
    .name { font: 12px ${t.mono}; } .detail, .muted { font-size: 11px; color: ${t.muted}; } .muted code { font-family: ${t.mono}; }
    .edit-shape { font-size: 11px; border: 0; background: transparent; color: ${t.accent}; }
    .detail-panel { background: ${t.surface}; border: 1px solid ${t.line}; border-radius: ${t.radius}; padding: 12px; display: grid; gap: 10px; }
    .title small { color: ${t.muted}; } .rename { display: flex; gap: 6px; align-items: center; font-size: 12px; } .rename input { flex: 1; min-width: 0; font-family: ${t.mono}; }
    .field, .add-field { display: flex; align-items: center; gap: 6px; font-size: 12px; margin: 4px 0; } .field code { font-family: ${t.mono}; } .field span { flex: 1; color: ${t.muted}; }
    .field-name { width: 84px; font-family: ${t.mono}; }
    .actions { display: flex; gap: 6px; } .actions .copy-brand { flex: 1; }
    .problem { color: ${t.danger}; font: 11px/16px ${t.mono}; } .warn { color: ${t.accent}; font-size: 11px; margin: 0; }
    .shape-editor { position: fixed; inset: 0; background: rgba(13, 15, 19, .82); z-index: 60; display: grid; place-items: center; overflow: auto; }
    .panel { background: ${t.bg}; border: 1px solid ${t.line}; border-radius: 14px; padding: 22px 24px; display: flex; gap: 24px; flex-wrap: wrap; max-width: 960px; box-shadow: 0 24px 60px rgba(0, 0, 0, .6); }
    .canvas-col { display: grid; gap: 12px; align-content: start; width: ${W}px; max-width: 100%; }
    .head b { font: 700 18px ${t.mono}; } .head small { color: ${t.muted}; }
    .canvas { position: relative; background: ${t.bg}; border: 1px solid ${t.line}; border-radius: 10px; box-sizing: border-box; touch-action: none; }
    .canvas svg { position: absolute; left: -1px; top: -1px; }
    .handle { position: absolute; box-sizing: border-box; cursor: move; border: 2px solid ${t.bg}; touch-action: none; }
    .handle.curve { border-radius: 50%; background: ${t.accent}; }
    .handle.point { border-radius: 2px; background: ${t.bg}; border-color: ${t.fg}; } .handle.end { background: ${t.muted}; } .handle.sel { background: ${t.accent}; }
    .controls { flex: 1; min-width: 260px; display: flex; flex-direction: column; gap: 6px; } .right { display: flex; justify-content: flex-end; }
    .presets { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .preset { height: 56px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border-radius: 8px; background: transparent; color: ${t.muted}; }
    .preset span { font-size: 9px; } .on { background: ${t.surface}; border-color: ${t.accent}; }
    .swatches, .patterns, .points { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .swatch { width: 28px; height: 28px; border-radius: ${t.radius}; border: 2px solid transparent; padding: 0; } .swatch.on { border-color: ${t.fg}; }
    .pattern { font-size: 11px; } .mirror { font-size: 12px; display: flex; gap: 6px; align-items: center; }
  `]
}

/** Register as `<${tag}>` (default `type-editor`); a no-op if taken. */
export const defineTypeEditor = (tag = 'type-editor') => { if (!customElements.get(tag)) customElements.define(tag, TypeEditorView) }
