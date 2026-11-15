/**
 * `<nano-wiring>`: the app as a tilted stack of runtime layers (their pods, pads and cables) and a side area for pods
 * placed in more than one runtime. Read-only. It rebuilds on `applied` and lights a cable for 600ms when it carries a message.
 */
import { LitElement } from 'lit'
import type { Application, Registry } from '@pritzlaff/nano'
import { MARGIN, ZOOM_MAX, ZOOM_MIN } from './constants'
import { frameId, layout, posKey, type Layout, type Rect } from './layout'
import { circuitOf } from './model'
import { renderPills } from './render-pills'
import { renderStage } from './render-stage'
import { styles } from './styles'
import type { Circuit } from './types'

type Target = { app: Application; registry: Registry }
/** The view: focused layer, zoom, pan, and what is selected (`pad:`, `cable:` or `fp:` + id). */
export interface State { focus: string | null; zoom: number; panX: number; panY: number; sel: string | null }
const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

export class NanoWiring extends LitElement {
  static properties = { target: { attribute: false } }
  static styles = styles
  declare target?: Target
  s: State = { focus: null, zoom: 1, panX: 0, panY: 0, sel: null }
  model: Circuit = { layers: [], side: [], cables: [] }
  geo: Layout = layout(this.model)
  dragging = false
  private off?: () => void
  private watching?: Target
  private fitted = false
  private drag: { x: number; y: number } | null = null
  private lit = new Map<string, ReturnType<typeof setTimeout>>()

  constructor() { super(); this.addEventListener('keydown', e => this.key(e)) }
  connectedCallback() { super.connectedCallback(); this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.stop() }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) this.watch() }
  render() { return [renderPills(this), renderStage(this)] }

  private watch() {
    const t = this.target
    if (!t || !this.isConnected || this.watching === t) return
    this.stop()
    this.watching = t
    this.off = t.app.listen(e => {
      if (e.type === 'applied') this.load(t)
      else if (e.type === 'sent') this.light(e.kind === 'call' ? `${e.runtime}|${e.from}|${e.to}|call|` : `${e.runtime}|${e.from}|${e.to}|${e.port}|`)
    })
    this.load(t)
  }
  private stop() { this.off?.(); this.off = undefined; this.watching = undefined; this.lit.forEach(clearTimeout); this.lit.clear() }
  private load(t: Target) {
    this.model = circuitOf(t.app.deployment(), t.registry)
    this.geo = layout(this.model)
    if (!this.model.layers.some(l => l.screen === this.s.focus)) this.s = { ...this.s, focus: this.model.layers[0]?.screen ?? null }
    if (!this.fitted && this.s.focus !== null) { this.fitted = true; this.fitPage(this.s.focus) }
    this.requestUpdate()
  }
  /** A cable is lit by prefix: its id starts with `runtime|from|to|port|` (a pipe's target port) or `...|call|`. */
  private light(prefix: string) {
    clearTimeout(this.lit.get(prefix))
    this.lit.set(prefix, setTimeout(() => { this.lit.delete(prefix); this.requestUpdate() }, 600))
    this.requestUpdate()
  }
  isLit(id: string) { return [...this.lit.keys()].some(p => id.startsWith(p)) }

  reduced() { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false }
  stageSize() { const st = this.renderRoot.querySelector<HTMLElement>('.stage'); return { w: st?.clientWidth || 1000, h: st?.clientHeight || 600 } }
  fitRect(r: Rect) {
    const { w, h } = this.stageSize(), zoom = clamp(Math.min(w / (r.w + 2 * MARGIN), h / (r.h + 2 * MARGIN)))
    this.s = { ...this.s, zoom, panX: -(r.x + r.w / 2) * zoom, panY: -(r.y + r.h / 2) * zoom }
    this.requestUpdate()
  }
  fitPage(id: string) { const i = this.model.layers.findIndex(l => l.screen === id); if (i >= 0) this.fitRect(this.geo.pageRect(i)) }
  fitAll() { this.fitRect(this.geo.bounds) }
  go(id: string) { this.s = { ...this.s, focus: id }; this.fitPage(id) }
  move(by: number) {
    const ls = this.model.layers, i = ls.findIndex(l => l.screen === this.s.focus), j = Math.min(ls.length - 1, Math.max(0, i + by))
    if (ls[j]) this.go(ls[j]!.screen)
  }
  key(e: KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') this.move(1)
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this.move(-1)
    else if (e.key === 'Escape' && this.s.sel) { this.select(null); this.refocus() }
    else return
    e.preventDefault()
  }
  refocus() { this.renderRoot.querySelector<HTMLElement>('.stage')?.focus() }
  select(sel: string | null) { this.s = { ...this.s, sel }; this.requestUpdate() }
  /** Pans to the other end of the selected pad's (or cable's) cable, focusing its layer if it has one. */
  follow() {
    const m = this.model, { sel } = this.s
    if (!sel) return
    const [what, ...rest] = sel.split(':'), id = rest.join(':')
    const cable = what === 'cable' ? m.cables.find(c => c.id === id) : m.cables.find(c => c.from.pad === id || c.to.pad === id)
    if (!cable) return
    const end = what === 'pad' && cable.from.pad === id ? cable.to : what === 'pad' ? cable.from : cable.to
    const p = this.geo.pos.get(posKey(frameId(end.at), end.pad))
    if (!p) return
    this.s = { ...this.s, sel: `pad:${end.pad}`, ...('layer' in end.at && { focus: end.at.layer }), panX: -p.x * this.s.zoom, panY: -p.y * this.s.zoom }; this.requestUpdate()
  }
  wheel(e: WheelEvent) { e.preventDefault(); this.s = { ...this.s, zoom: clamp(this.s.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))) }; this.requestUpdate() }
  dragStart(e: PointerEvent) {
    if ((e.target as Element).closest('button, input, aside, g[data-cable-hit]')) return
    this.drag = { x: e.clientX, y: e.clientY }; this.dragging = true
    const move = (m: PointerEvent) => {
      if (!this.drag) return
      this.s = { ...this.s, panX: this.s.panX + m.clientX - this.drag.x, panY: this.s.panY + m.clientY - this.drag.y }
      this.drag = { x: m.clientX, y: m.clientY }; this.requestUpdate()
    }
    const up = () => { this.drag = null; this.dragging = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); this.requestUpdate() }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
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
