// <c-wires>: the prototype's Component class as a Lit element over the live app. It holds the view state and keeps the
// model in step with the app and the dock; edit.ts edits the app, packets.ts traces it, the render-* files draw it.
import { LitElement } from 'lit'
import type { AppDeployment, AppEvent } from '@pritzlaff/nano-core'
import type { Host } from '../host.ts'
import { FLASH_MS, FRAME_MS, TURN_MS, VIEWS, type View } from './constants'
import { onWheel, zoomBy } from './camera'
import { catalogOf, change, connect, create, disconnect, openPanel, removeComponent } from './edit'
import { buildModel, snapshotOf, type Model, type Panel } from './model'
import { loadFonts, panelsOf, styles } from './page'
import { landPackets, tracePacket } from './packets'
import { buildPuzzle } from './puzzle'
import { renderRoot } from './render-root'
import { empty, initial, type Catalog, type Selection, type State } from './state'

export type { Catalog, Cord, Packet, Result, Selection, State } from './state'

/** The wiring view: slot the live `<workspace-dock>`; its `dock:connections` event flips it to show the back. */
export class Wires extends LitElement {
  static properties = { host: { attribute: false }, application: {}, system: {}, flipped: { type: Boolean, reflect: true } }
  static styles = styles
  /** The page's host: its app, registry and deployment. */
  declare host?: Host
  /** The host's own pod, never shown. */
  declare application: string
  declare system: string
  declare flipped: boolean
  s: State = initial()
  model: Model = empty()
  puzzle = buildPuzzle(this.model)
  stage = { w: 0, h: 0 }
  drag: { x: number; y: number; ry: number; rx: number } | null = null
  #off: (() => void)[] = []
  #timer?: ReturnType<typeof setInterval>
  #layout = ''
  #pending = false

  constructor() {
    super()
    this.application = 'ui'; this.system = ''; this.flipped = false
    this.addEventListener('dock:connections', () => { if (this.flipped) this.close(); else this.flipped = true })
  }
  connectedCallback() { super.connectedCallback(); loadFonts(this.ownerDocument); if (this.hasUpdated) this.#attach() }
  disconnectedCallback() { super.disconnectedCallback(); this.#detach(); this.#stop() }
  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('host')) { this.#detach(); this.#attach() }
    if (changed.has('flipped')) this.flipped ? this.#open() : this.#close()
  }
  render() { return renderRoot(this) }

  /** React-style setState: merges a patch and re-renders. */
  setState(patch: Partial<State>) {
    if ('ry' in patch || 'rx' in patch) patch = { zooming: false, ...patch }   // camera moves ease again
    this.s = { ...this.s, ...patch }; this.requestUpdate()
  }
  /** Zooms by a factor (kept within 0.25–4), about a client point if given, so what is under it stays put. */
  zoomBy(factor: number, at?: { clientX: number; clientY: number }) { zoomBy(this, factor, at) }
  /** Pinch or ctrl/cmd+scroll zooms about the pointer; scrolling pans. */
  onWheel(e: WheelEvent) { onWheel(this, e) }
  /** Selects a component, or one of its actions, through the Application, and shows it in Detail. */
  // BACKLOG(6): the old Application kept the selection (select / selectionChanged); 0.4 has none, so it is the view's own.
  pick(sel: Exclude<Selection, null>) { this.setState({ picked: sel, tab: 'detail' }) }
  /** Back to the fitted view. */
  fit() { this.setState({ zoom: 1, panX: 0, panY: 0, zooming: false }) }
  now() { return performance.now() }
  recent(at: number | undefined) { return at !== undefined && this.now() - at < FLASH_MS }
  /** The slotted dock. */
  dock() { return this.firstElementChild as HTMLElement | null }

  #attach() {
    const h = this.host
    if (!h || !this.isConnected || this.#off.length) return
    this.#off = [h.app.listen(e => { if (e.type === 'applied' || (e.type === 'sent' && e.kind === 'call')) this.schedule(); else this.trace(e) })]
    this.rebuild()
  }
  #detach() { this.#off.forEach(f => f()); this.#off = [] }

  /** Rebuilds the model once, after the current burst of registry changes; only while flipped (opening rebuilds). */
  schedule() { if (!this.flipped) return; if (!this.#pending) { this.#pending = true; queueMicrotask(() => { this.#pending = false; this.rebuild() }) } }
  panels(): Panel[] { return panelsOf(this.dock()) }
  rebuild() {
    const h = this.host
    if (!h) return
    const snapshot = snapshotOf(h.data(), h.registry, h.calls?.()), panels = this.panels(), kinds: Record<string, string> = {}
    for (const i of snapshot.instances) { const k = this.kindOf(i.id); if (k) kinds[i.id] = k }
    const titles = Object.fromEntries(Object.entries(this.catalog).map(([k, e]) => [k, e.title]))
    this.#layout = JSON.stringify(panels)
    this.model = buildModel({ snapshot, panels, W: this.model.W, H: this.model.H, application: this.application, kinds, titles })
    this.puzzle = buildPuzzle(this.model)
    this.requestUpdate()
  }
  /** The kind an instance was made from: its pod's implementation. */
  kindOf(id: string) { return this.host?.data().pods[id]?.implementation }
  /** What the host can make (the dock's palette), by implementation coordinate. */
  get catalog(): Catalog { return catalogOf(this.host) }
  /** A pipe message on a drawn wire sends a packet along it, flashes its source and counts it. */
  trace(t: AppEvent) { tracePacket(this, t) }

  /** Each frame: packets that arrived flash their target; a changed dock layout rebuilds the model. */
  frame() {
    landPackets(this)
    if (JSON.stringify(this.panels()) !== this.#layout) this.rebuild()
    this.measure()
    const hot = [...Object.values(this.s.hits), ...Object.values(this.s.flashes)].some(at => this.recent(at))
    if (this.s.packets.length || hot) this.requestUpdate()
  }

  #open() {
    const dock = this.dock()
    this.model = { ...this.model, W: dock?.offsetWidth || 1340, H: dock?.offsetHeight || 560 }
    this.rebuild()
    this.s = { ...this.s, ry: 0, rx: 0, dragging: false, entering: true, leaving: false, zoom: 1, panX: 0, panY: 0, zooming: false, packets: [] }
    this.#stop()
    this.#timer = setInterval(() => this.frame(), FRAME_MS)
    setTimeout(() => { this.measure(); this.setState({ entering: false }) }, 60)   // starts at full size, then eases back
  }
  #close() { this.#stop(); this.s = { ...this.s, editing: false, cord: null, armed: null, selMod: null, lift: null, toast: null, dragging: false, leaving: false } }
  #stop() { clearInterval(this.#timer); this.#timer = undefined }

  /** Done: the drawer fades out and the pane eases forward to full size, then the plain dock is back. */
  close() {
    if (!this.flipped || this.s.leaving) return
    this.setState({ leaving: true, editing: false, cord: null, armed: null, selMod: null, lift: null, toast: null, dragging: false, ry: 360 * Math.round(this.s.ry / 360), rx: 0 })
    setTimeout(() => { if (this.s.leaving) this.flipped = false }, TURN_MS)
  }
  /** The stage's size, which the pane is fitted to; a change re-renders. */
  measure() {
    const st = this.renderRoot.querySelector<HTMLElement>('.stage-bg')
    if (st && (st.clientWidth !== this.stage.w || st.clientHeight !== this.stage.h)) { this.stage = { w: st.clientWidth, h: st.clientHeight }; this.requestUpdate() }
  }
  goTo(name: View) {
    const v = VIEWS[name]
    const target = v.ry + 360 * Math.round((this.s.ry - v.ry) / 360)
    this.setState({ ry: target, rx: v.rx, dragging: false, editing: false, cord: null, armed: null, selMod: null })
  }
  change(edit: (d: AppDeployment) => AppDeployment | string, value?: unknown) { return change(this, edit, value) }
  connect(from: string, to: string) { return connect(this, from, to) }
  disconnect(id: string) { return disconnect(this, id) }
  removeComponent(instance: string) { return removeComponent(this, instance) }
  create(kind: string) { return create(this, kind) }
  openPanel(name: string) { return openPanel(this, name) }
  ok(text: string) { this.setState({ cord: null, toast: { kind: 'ok', text } }) }
  fail(text: string) { this.setState({ cord: null, toast: { kind: 'err', text } }) }

  /** The system shown: `system`, or the host's runtime `main`. */
  get sys() { return this.system || 'main' }
}

/** Registers <c-wires>. */
export const defineWires = () => { if (!customElements.get('c-wires')) customElements.define('c-wires', Wires) }
