// <puzzle-port>: the prototype's Component class as a Lit element. It holds the state and the handlers; the render-*
// files draw it, as the prototype's template does from renderVals.
import { LitElement, css } from 'lit'
import { CANVAS_W, CELL, OX, OY, SWATCHES, bug, byIdOf, type Action, type Model, type TypeDef } from './constants'
import { movePoint, presetShape, removeAnchor, splitSegment, type Target } from './geometry'
import { emptyModel, loadModel, occupancy, omit, key, roleOf, saveModel, usesOf, type Storage } from './model'
import { refreshSha } from './sha'
import { modelToTs, planTs } from './ts-view'
import { dropCell, type Drag } from './board'
import { renderRoot } from './render-root'

/** The action form's state (one element's "+" form). */
export interface ActionForm { elementId: string; name: string; input: string | null; output: string | null; inArray: boolean; outArray: boolean; inQuery: string; outQuery: string; errors: string[] }
/** All of the prototype's state. */
export interface State {
  model: Model; storage: Storage; tab: 'elements' | 'types'; selectedAction: string | null; selectedType: string | null
  editorOpen: boolean; drag: Drag | null; notice: string; panelErrors: string[]; elementDraft: string | null; typeDraft: string | null
  brandDraft: { sourceId: string; value: string } | null; actionForm: ActionForm | null; fieldPicker: { typeId: string; index: number } | null
  handleDrag: Target | null; selectedAnchor: number | null; mirror: boolean; editorMessage: string
  codeOpen: boolean; codeText: string; codeMessage: string; showModel: boolean
}

const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap'
/** Fonts only reach a shadow root when the document loads them, so the link goes into the document's head, once. */
function loadFonts(doc: Document) {
  if (doc.head.querySelector('link[data-puzzle-port-fonts]')) return
  const link = doc.createElement('link')
  link.rel = 'stylesheet'; link.href = FONTS; link.dataset.puzzlePortFonts = ''
  doc.head.append(link)
}

/** The puzzle editor prototype, on a fixed 1440×900 artboard. */
export class PuzzlePort extends LitElement {
  static styles = css`:host { display: block; width: 1440px; height: 900px } a { color: #9EC3FF } a:hover { color: #C7DCFF }`
  s: State
  ctx: { rect: DOMRect; scale: number; sx: number; sy: number } | null = null
  shapeCtx: { rect: DOMRect; scale: number } | null = null

  constructor() {
    super()
    const loaded = loadModel()
    this.s = {
      model: loaded.model, storage: loaded.storage, tab: 'elements', selectedAction: null, selectedType: null, editorOpen: false, drag: null,
      notice: loaded.notice, panelErrors: [], elementDraft: null, typeDraft: null, brandDraft: null, actionForm: null, fieldPicker: null,
      handleDrag: null, selectedAnchor: null, mirror: true, editorMessage: '', codeOpen: false, codeText: '', codeMessage: '', showModel: false
    }
  }
  connectedCallback() { super.connectedCallback(); loadFonts(this.ownerDocument) }
  render() { return renderRoot(this) }

  /** React-style setState: merges a patch (or a function of the state); a new model is saved, as componentDidUpdate does. */
  setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
    const prev = this.s
    const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }
    if (next.model !== prev.model) {
      const st = saveModel(next.model)
      if (st.ok !== next.storage.ok) next.storage = st
    }
    this.s = next
    this.requestUpdate()
  }
  setModel(fn: (m: Model) => Model) { this.setState(s => ({ model: fn(s.model) })) }
  typeById(): Record<string, TypeDef> { return byIdOf(this.s.model.types) }

  // ---------- board dragging ----------
  toLocal(e: MouseEvent) {
    if (this.ctx === null) return bug('no drag context')
    return { x: (e.clientX - this.ctx.rect.left) / this.ctx.scale, y: (e.clientY - this.ctx.rect.top) / this.ctx.scale }
  }
  startDrag(id: string, fromPanel: boolean, e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const canvas = this.renderRoot.querySelector('[data-canvas="puzzle"]')
    if (canvas === null) return bug('canvas missing')
    const rect = canvas.getBoundingClientRect()
    this.ctx = { rect, scale: rect.width / CANVAS_W, sx: e.clientX, sy: e.clientY }
    const p = this.toLocal(e)
    const pl = this.s.model.placements[id]
    const grab = pl !== undefined && !fromPanel ? { gx: p.x - (OX + pl.c * CELL), gy: p.y - (OY + pl.r * CELL) } : { gx: CELL / 2, gy: CELL / 2 }
    this.setState({ drag: { id, x: p.x, y: p.y, gx: grab.gx, gy: grab.gy, moved: false }, selectedAction: id, notice: '' })
  }
  moveImpl(e: MouseEvent) {
    const d = this.s.drag
    if (d === null || this.ctx === null) return
    if (!d.moved && Math.hypot(e.clientX - this.ctx.sx, e.clientY - this.ctx.sy) < 4) return
    const p = this.toLocal(e)
    this.setState(s => ({ drag: { ...s.drag!, x: p.x, y: p.y, moved: true } }))
  }
  upImpl() {
    const d = this.s.drag
    if (d === null) return
    this.ctx = null
    if (!d.moved) { this.setState({ drag: null }); return }
    const placed = this.s.model.placements[d.id] !== undefined
    if (d.x < 0) {
      this.setState({ drag: null, notice: placed ? 'Taken off the board.' : '' })
      this.setModel(m => ({ ...m, placements: omit(m.placements, d.id) }))
      return
    }
    const cell = dropCell(d)
    if (cell === null) { this.setState({ drag: null, notice: 'Dropped outside the grid, so nothing moved.' }); return }
    const occ = occupancy(omit(this.s.model.placements, d.id))
    if (occ[key(cell.c, cell.r)] !== undefined) { this.setState({ drag: null, notice: 'That square is taken.' }); return }
    this.setState({ drag: null, notice: '' })
    this.setModel(m => ({ ...m, placements: { ...m.placements, [d.id]: cell } }))
  }
  leave() { this.ctx = null; this.setState({ drag: null }) }

  // ---------- elements & actions ----------
  saveElement() {
    const name = (this.s.elementDraft ?? '').trim()
    if (name === '') { this.setState({ panelErrors: ['Give the element a name.'] }); return }
    if (this.s.model.elements.some(el => el.name === name)) { this.setState({ panelErrors: ['There is already an element called ' + name + '.'] }); return }
    const id = 'e' + this.s.model.nextId
    this.setModel(m => ({ ...m, nextId: m.nextId + 1, elements: m.elements.concat([{ id, name }]) }))
    this.setState({ elementDraft: null, panelErrors: [], actionForm: this.blankActionForm(id) })
  }
  removeElement(id: string) {
    const acts = this.s.model.actions.filter(a => a.elementId === id)
    if (acts.length > 0) { this.setState({ panelErrors: ['Delete its ' + acts.length + ' action(s) first.'] }); return }
    this.setModel(m => ({ ...m, elements: m.elements.filter(el => el.id !== id) }))
    this.setState({ panelErrors: [] })
  }
  blankActionForm(elementId: string): ActionForm { return { elementId, name: '', input: null, output: null, inArray: false, outArray: false, inQuery: '', outQuery: '', errors: [] } }
  patchActionForm(patch: Partial<ActionForm>) { this.setState(s => ({ actionForm: { ...s.actionForm!, ...patch, errors: [] } })) }
  saveAction() {
    const f = this.s.actionForm
    if (f === null) return bug('saveAction with no form')
    const errors: string[] = []
    const name = f.name.trim()
    if (name === '') errors.push('Give the action a name.')
    if (f.input === null && f.output === null) errors.push('Pick an input, an output, or both.')
    if (this.s.model.actions.some(a => a.elementId === f.elementId && a.name === name)) errors.push('This element already has ' + name + '.')
    if (errors.length > 0) { this.setState({ actionForm: { ...f, errors } }); return }
    const id = 'a' + this.s.model.nextId
    const action: Action = {
      id, elementId: f.elementId, name,
      input: f.input === null ? null : { typeId: f.input, array: f.inArray },
      output: f.output === null ? null : { typeId: f.output, array: f.outArray },
      inputSide: 'L', outputSide: 'R'
    }
    roleOf(action)
    this.setModel(m => ({ ...m, nextId: m.nextId + 1, actions: m.actions.concat([action]) }))
    this.setState({ actionForm: null, selectedAction: id, notice: 'Added ' + name + '. Drag it onto the board.' })
  }
  removeAction(id: string) {
    this.setModel(m => ({ ...m, actions: m.actions.filter(a => a.id !== id), placements: omit(m.placements, id) }))
    this.setState({ selectedAction: null })
  }
  patchAction(id: string, fn: (a: Action) => Action) { this.setModel(m => ({ ...m, actions: m.actions.map(a => (a.id === id ? fn(a) : a)) })) }

  // ---------- types ----------
  saveRecordType() {
    const name = (this.s.typeDraft ?? '').trim()
    if (name === '') { this.setState({ panelErrors: ['Give the type a name.'] }); return }
    if (this.s.model.types.some(t => t.name === name)) { this.setState({ panelErrors: [name + ' already exists.'] }); return }
    const id = 't' + this.s.model.nextId
    const colour = SWATCHES[(this.s.model.types.length + 3) % SWATCHES.length]!
    const type: TypeDef = { id, name, kind: 'record', builtIn: false, fields: [{ name: 'field1', typeId: 'string', array: false }], shape: presetShape('house'), colour, pattern: 'none', shapeSource: 'sha' }
    this.setModel(m => ({ ...m, nextId: m.nextId + 1, types: refreshSha(m.types.concat([type])) }))
    this.setState({ typeDraft: null, panelErrors: [], selectedType: id, editorOpen: true })
  }
  patchType(id: string, fn: (t: TypeDef) => TypeDef) { this.setModel(m => ({ ...m, types: refreshSha(m.types.map(t => (t.id === id ? fn(t) : t))) })) }
  patchLook(id: string, fn: (t: TypeDef) => TypeDef) { this.patchType(id, t => ({ ...fn(t), shapeSource: 'custom' })) }
  regenerate(id: string) { this.patchType(id, t => ({ ...t, shapeSource: 'sha' })); this.setState({ selectedAnchor: null }) }
  openCode() { this.setState({ codeOpen: true, codeText: modelToTs(this.s.model.types), codeMessage: '' }) }
  applyCode() {
    const plan = planTs(this.s.model, this.s.codeText)
    if (!plan.ok) { this.setState({ codeMessage: 'Not applied: fix the problems listed.' }); return }
    this.setState({ model: plan.model, codeText: modelToTs(plan.model.types), codeMessage: 'Applied: ' + plan.summary + '.' })
  }
  patchField(typeId: string, index: number, patch: Partial<{ name: string; typeId: string; array: boolean }>) {
    this.patchType(typeId, t => {
      if (t.kind !== 'record') return bug('patchField on non-record ' + t.name)
      return { ...t, fields: t.fields!.map((f, i) => (i === index ? { ...f, ...patch } : f)) }
    })
  }
  saveBrand() {
    const d = this.s.brandDraft
    if (d === null) return bug('saveBrand with no draft')
    const name = d.value.trim()
    if (name === '') { this.setState({ panelErrors: ['Give the brand a name.'] }); return }
    if (this.s.model.types.some(t => t.name === name)) { this.setState({ panelErrors: [name + ' already exists.'] }); return }
    const src = this.typeById()[d.sourceId]
    if (src === undefined) return bug('brand source missing')
    const id = 't' + this.s.model.nextId
    const type: TypeDef = { id, name, kind: 'alias', builtIn: false, aliasFor: src.id, shape: src.shape, colour: src.colour, pattern: 'diag', shapeSource: 'sha' }
    this.setModel(m => ({ ...m, nextId: m.nextId + 1, types: refreshSha(m.types.concat([type])) }))
    this.setState({ brandDraft: null, panelErrors: [], selectedType: id, editorOpen: true })
  }
  removeType(id: string) {
    const uses = usesOf(this.s.model, id)
    if (uses.length > 0) { this.setState({ panelErrors: ['Still used by: ' + uses.join(', ') + '.'] }); return }
    this.setModel(m => ({ ...m, types: m.types.filter(t => t.id !== id) }))
    this.setState({ selectedType: null, editorOpen: false, panelErrors: [] })
  }

  // ---------- shape push editor ----------
  editorPoint(e: MouseEvent) {
    if (this.shapeCtx === null) return bug('no shape editor context')
    const x = (e.clientX - this.shapeCtx.rect.left) / this.shapeCtx.scale
    const y = (e.clientY - this.shapeCtx.rect.top) / this.shapeCtx.scale
    return { u: (y - 20) / 3, v: (x - 200) / 3 }
  }
  handleDown(target: Target, e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const el = this.renderRoot.querySelector('[data-shape-editor="1"]')
    if (el === null) return bug('shape editor missing')
    const rect = el.getBoundingClientRect()
    this.shapeCtx = { rect, scale: rect.width / 420 }
    this.setState({ handleDrag: target, selectedAnchor: target.kind === 'anchor' ? target.index : this.s.selectedAnchor, editorMessage: '' })
  }
  editorMove(e: MouseEvent) {
    const target = this.s.handleDrag
    if (target === null) return
    const p = this.editorPoint(e)
    const mirror = this.s.mirror
    this.patchLook(this.s.selectedType!, t => ({ ...t, shape: movePoint(t.shape, target, [p.u, p.v], mirror) }))
  }
  editorUp() { if (this.s.handleDrag !== null) this.setState({ handleDrag: null }) }
  addPoint() {
    const t = this.typeById()[this.s.selectedType!]
    if (t === undefined) return bug('addPoint with no type')
    const n = t.shape.segs.length
    const sel = this.s.selectedAnchor
    const si = sel === null ? Math.floor(n / 2) : Math.min(sel, n - 1)
    this.patchLook(t.id, x => ({ ...x, shape: splitSegment(x.shape, si) }))
    this.setState({ selectedAnchor: si + 1, editorMessage: '' })
  }
  removePoint() {
    const t = this.typeById()[this.s.selectedType!]
    if (t === undefined) return bug('removePoint with no type')
    const k = this.s.selectedAnchor
    const n = t.shape.segs.length
    if (k === null || k < 1 || k > n - 1) { this.setState({ editorMessage: 'Select a middle point first. The two end points sit on the edge and stay.' }); return }
    this.patchLook(t.id, x => ({ ...x, shape: removeAnchor(x.shape, k) }))
    this.setState({ selectedAnchor: null, editorMessage: '' })
  }
  clearAll() { this.ctx = null; this.setState({ model: emptyModel(), selectedAction: null, selectedType: null, editorOpen: false, actionForm: null, notice: 'Cleared.' }) }
}

/** Defines <puzzle-port> once. */
export function definePuzzlePort() { if (!customElements.get('puzzle-port')) customElements.define('puzzle-port', PuzzlePort) }
