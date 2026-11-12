// <c-circuit>: the app as a tilted stack of page layers and a side area of systems. Read-only: it fetches the Application's
// systems, kinds, screens and placements through ops, rebuilds on its `changed`, and holds the view (focus, zoom, pan).
import { LitElement, css } from 'lit'
import { Ops, type Op, type Runtime } from '@pritzlaff/nano-core'
import { ApplicationOps as P } from '@pritzlaff/nano-app'
import { MARGIN, ZOOM_MAX, ZOOM_MIN } from './constants'
import { layout, type Layout, type Rect } from './layout'
import { buildCircuit } from './model'
import { renderPills } from './render-pills'
import { renderStage } from './render-stage'
import type { Circuit as Model } from './types'

export interface State {
  focus: string | null; zoom: number; panX: number; panY: number
  /** For the covers and drawer (a later task): what is selected, which instance is lifted, and what each page hides. */
  sel: string | null; lift: string | null; hidden: Record<string, Set<string>>
}
const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
const none: Model = { layers: [], side: [], cables: [] }

export class Circuit extends LitElement {
  static properties = { runtime: { attribute: false }, application: {} }
  static styles = css`
    :host { display: block; height: 100%; min-height: 360px; color: #E6EDF3; font: 12px system-ui, sans-serif }
    .pills { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px; background: #0B0E12 }
    .pill { display: inline-flex; gap: 6px; align-items: center; padding: 4px 10px; border: 1px solid #2A323D; border-radius: 999px; background: #12161C; color: inherit; font: inherit; cursor: pointer }
    .pill[aria-pressed="true"] { border-color: #4CC2FF; color: #4CC2FF }
    .ic { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 4px; background: #1E252F; font-size: 10px }
    .stage { position: relative; height: calc(100% - 44px); overflow: hidden; perspective: 2400px; background: #0B0E12 radial-gradient(#1C222B 1px, transparent 1px) 0 0 / 22px 22px; cursor: grab; user-select: none; touch-action: none }
    .world { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform-style: preserve-3d; transform-origin: 0 0 }
    .world.anim { transition: transform .5s ease }
    .frame { position: absolute; transform-style: preserve-3d }
    .layer { position: absolute; left: 0; top: 0; background: #12161C; border: 1px solid #2A323D; border-radius: 8px }
    .ltitle { position: absolute; left: 0; top: -22px; margin: 0; font-size: 12px; color: #94a3b8; white-space: nowrap }
    .layer .ltitle { left: 8px; top: 6px }
    .fp { position: absolute; box-sizing: border-box; border: 1px solid #2A323D; border-radius: 6px; background: #181E26 }
    .ftitle { position: absolute; left: 14px; top: 8px; font-weight: 600 }
    .pad { position: absolute; width: 24px; height: 24px; padding: 0; border: 2px solid; font: 600 10px ui-monospace, monospace; cursor: pointer }
    .plabel { position: absolute; font-size: 10px; color: #94a3b8; white-space: nowrap }
    .tab { position: absolute; box-sizing: border-box; padding: 0 6px; border: 1px solid #2A323D; border-bottom: 0; border-radius: 6px 6px 0 0; background: #12161C; color: inherit; font: 10px system-ui; overflow: hidden; text-overflow: ellipsis; cursor: pointer }
    .tab[aria-pressed="true"] { background: #181E26; color: #4CC2FF }
    .cables { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none }
    .pad:focus-visible, .pill:focus-visible, .tab:focus-visible, .stage:focus-visible { outline: 2px solid #4CC2FF; outline-offset: 2px }
    .minimap { position: absolute; right: 12px; bottom: 12px; width: 176px; height: 108px; background: #0B0E12cc; border: 1px solid #2A323D; border-radius: 6px }
    .mm-layer { fill: #1E252F } .mm-layer[data-focus="true"] { fill: #2c5a73 } .mm-side { fill: #2A323D } .mm-view { fill: none; stroke: #4CC2FF; stroke-width: 12 }`
  declare runtime?: Runtime
  /** The instance the Application lives in. */
  declare application: string
  s: State = { focus: null, zoom: 1, panX: 0, panY: 0, sel: null, lift: null, hidden: {} }
  model: Model = none
  geo: Layout = layout(none)
  systems: string[] = []
  dragging = false
  #off: (() => void)[] = []
  #pending = false
  #fitted = false
  #drag: { x: number; y: number } | null = null

  constructor() {
    super()
    this.application = 'application'
    this.addEventListener('keydown', e => this.key(e))
  }
  /** The focused screen id. (Not `focus`: that is HTMLElement.focus().) */
  get page() { return this.s.focus }
  set page(id: string | null) { this.s = { ...this.s, focus: id }; this.#fitted && id !== null && this.fitPage(id); this.requestUpdate() }

  connectedCallback() { super.connectedCallback(); if (this.hasUpdated) this.#attach() }
  disconnectedCallback() { super.disconnectedCallback(); this.#detach() }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('runtime')) { this.#detach(); this.#attach() } }
  render() { return [renderPills(this), renderStage(this)] }

  #attach() {
    const rt = this.runtime
    if (!rt || !this.isConnected || this.#off.length) return
    this.#off = [rt.listen(t => { if (t.kind === 'publish' && t.from.instance === this.application && t.op === Ops.key(P.changed)) this.schedule() })]
    this.schedule()
  }
  #detach() { this.#off.forEach(f => f()); this.#off = [] }
  /** Reloads once, after the current burst of changes. */
  schedule() { if (!this.#pending) { this.#pending = true; queueMicrotask(() => { this.#pending = false; void this.load() }) } }

  async load() {
    const rt = this.runtime
    if (!rt) return
    const ask = async <A>(op: Op, arg: unknown): Promise<A> => {
      const r = await rt.call({ registry: rt.registry.id, instance: 'circuit' }, this.application, Ops.key(op), arg)
      return 'error' in r ? ([] as A) : (r.value as A)
    }
    const [systems, kinds, screens, placements] = await Promise.all([ask<any[]>(P.systems, undefined), ask<any[]>(P.kinds, undefined), ask<any[]>(P.screens, undefined), ask<any[]>(P.placements, {})])
    if (!this.#off.length) return   // detached while waiting
    this.model = buildCircuit({ systems, screens, placements, kinds })
    this.geo = layout(this.model)
    this.systems = systems.map(s => s.id)
    if (!this.model.layers.some(l => l.screen === this.s.focus)) this.s = { ...this.s, focus: this.model.layers[0]?.screen ?? null }
    if (!this.#fitted && this.s.focus !== null) { this.#fitted = true; this.fitPage(this.s.focus) }
    this.requestUpdate()
  }

  reduced() { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false }
  stageSize() { const st = this.renderRoot.querySelector<HTMLElement>('.stage'); return { w: st?.clientWidth || 1000, h: st?.clientHeight || 600 } }
  /** Pans and zooms so the world rect fills the stage. */
  fitRect(r: Rect) {
    const { w, h } = this.stageSize(), zoom = clamp(Math.min(w / (r.w + 2 * MARGIN), h / (r.h + 2 * MARGIN)))
    this.s = { ...this.s, zoom, panX: -(r.x + r.w / 2) * zoom, panY: -(r.y + r.h / 2) * zoom }
    this.requestUpdate()
  }
  fitPage(id: string) { const i = this.model.layers.findIndex(l => l.screen === id); if (i >= 0) this.fitRect(this.geo.pageRect(i)) }
  fitAll() { this.fitRect(this.geo.bounds) }
  fitSystem(id: string) { this.fitRect((this.geo.blocks.find(b => b.block.system === id) ?? this.geo.layers.find(l => l.layer.system === id) ?? { rect: this.geo.bounds }).rect) }
  /** Focuses a page and fits it. */
  go(id: string) { this.s = { ...this.s, focus: id }; this.fitPage(id) }
  move(by: number) {
    const ls = this.model.layers, i = ls.findIndex(l => l.screen === this.s.focus), j = Math.min(ls.length - 1, Math.max(0, i + by))
    if (ls[j]) this.go(ls[j]!.screen)
  }
  key(e: KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') this.move(1)
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this.move(-1)
    else return
    e.preventDefault()
  }

  wheel(e: WheelEvent) { e.preventDefault(); this.s = { ...this.s, zoom: clamp(this.s.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))) }; this.requestUpdate() }
  dragStart(e: PointerEvent) {
    if ((e.target as Element).closest('button')) return
    this.#drag = { x: e.clientX, y: e.clientY }; this.dragging = true
    const move = (m: PointerEvent) => {
      if (!this.#drag) return
      this.s = { ...this.s, panX: this.s.panX + m.clientX - this.#drag.x, panY: this.s.panY + m.clientY - this.#drag.y }
      this.#drag = { x: m.clientX, y: m.clientY }; this.requestUpdate()
    }
    const up = () => { this.#drag = null; this.dragging = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.requestUpdate() }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  /** Centres the view on the world point clicked in the minimap. */
  panFromMinimap(e: MouseEvent) {
    const el = e.currentTarget as SVGSVGElement, r = el.getBoundingClientRect(), b = this.geo.bounds
    if (!r.width || !r.height) return
    const k = Math.max((b.w + 2 * MARGIN) / r.width, (b.h + 2 * MARGIN) / r.height)
    const wx = b.x + b.w / 2 + (e.clientX - r.left - r.width / 2) * k, wy = b.y + b.h / 2 + (e.clientY - r.top - r.height / 2) * k
    this.s = { ...this.s, panX: -wx * this.s.zoom, panY: -wy * this.s.zoom }; this.requestUpdate()
  }
}
export function defineCircuit() { if (!customElements.get('c-circuit')) customElements.define('c-circuit', Circuit) }
