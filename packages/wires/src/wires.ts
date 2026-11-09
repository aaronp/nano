// <c-wires>: the prototype's Component class as a Lit element over the live system. It holds the view state, keeps
// the model in step with the registry and the dock's layout, turns trace deliveries into packets, and edits the
// system through the platform. The render-* files draw it, as the prototype's template does from renderVals.
import { LitElement, css } from 'lit'
import { Ops, type Op, type Result, type Runtime, type Trace } from '@pritzlaff/nano-core'
import { PlatformOps } from '@composable/platform'
import type { Catalog } from '@pritzlaff/nano-elements'
import { FLASH_MS, FONTS, FRAME_MS, MAX_PACKETS, TRAVEL_MS, TURN_MS, VIEWS, short, type View } from './constants'
import { buildModel, type Model, type Panel } from './model'
import { buildPuzzle } from './puzzle'
import { renderRoot } from './render-root'

/** A cord being dragged: from `anchor`, maybe picked off a plugged input (`picked` is that wire). */
export type Cord = { anchor: string; picked: string | null; x: number; y: number; hover: string | null; err: string | null }
/** A message in flight along a wire (a subscription), from a trace delivery. */
export type Packet = { id: number; wire: string; born: number; label: string }
/** All of the view's state. */
export interface State {
  ry: number; rx: number; dragging: boolean; mode: 'relay' | 'puzzle'; sel: string | null; depth: number; editing: boolean; entering: boolean; leaving: boolean
  /** Zoom (1 = fitted) and pan (screen px) on top of the camera; `zooming` makes them follow the wheel without easing. */
  zoom: number; panX: number; panY: number; zooming: boolean
  cord: Cord | null; armed: string | null; selMod: string | null; lift: string | null; toast: { kind: 'ok' | 'err'; text: string } | null
  packets: Packet[]; hits: Record<string, number>; flashes: Record<string, number>; stats: Record<string, { in: number; out: number }>
}

const empty = (): Model => ({ W: 1340, H: 560, chassis: [], rack: [], P: {}, wires: [], routes: [], rackH: 128 })
/** Fonts only reach a shadow root when the document loads them, so the link goes into the document's head, once. */
function loadFonts(doc: Document) {
  if (doc.head.querySelector('link[data-wires-fonts]')) return
  const link = doc.createElement('link')
  link.rel = 'stylesheet'; link.href = FONTS; link.dataset.wiresFonts = ''
  doc.head.append(link)
}
/** A panel's instance: the `model` of the first element inside it that has one. */
const modelIn = (panel: Element) => [...panel.querySelectorAll('*')].find(e => typeof (e as { model?: unknown }).model === 'string') as (Element & { model: string }) | undefined
/** An element's layout box relative to `dock`, from offsets: unlike client rects, these ignore the 3D transform. */
const rectIn = (el: HTMLElement, dock: HTMLElement) => {
  let x = 0, y = 0, e: HTMLElement | null = el
  while (e && e !== dock && dock.contains(e)) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent as HTMLElement | null }
  if (e !== dock) { x -= dock.offsetLeft; y -= dock.offsetTop }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight }
}
let packetId = 0

/** The wiring view: slot the live `<workspace-dock>`; its `dock:connections` event flips it to show the back. */
export class Wires extends LitElement {
  static properties = { runtime: { attribute: false }, catalog: { attribute: false }, platform: {}, system: {}, flipped: { type: Boolean, reflect: true } }
  static styles = css`
    :host { display: block; height: 100% }
    .stage-bg{background-color:#0B0E12;background-image:radial-gradient(#1C222B 1px, transparent 1px);background-size:22px 22px}
    .plate-bg{background-color:#12161C;background-image:radial-gradient(#1E252F 1px, transparent 1px);background-size:14px 14px}
    .flow{stroke-dasharray:3 13;animation:dcflow 0.9s linear infinite}
    .noflow{stroke-dasharray:none}
    .live{stroke-dasharray:6 6;animation:dcflow 0.6s linear infinite}
    @keyframes dcflow{to{stroke-dashoffset:-32}}
    .mono{font-family:'JetBrains Mono',ui-monospace,monospace}
    .sidebtn:focus-visible,.seg:focus-visible,.route:focus-visible,.joint:focus-visible,.piecebtn:focus-visible{outline:2px solid #4CC2FF;outline-offset:2px}
    .sidebtn:disabled{opacity:0.4;cursor:not-allowed}
    .joint:hover{background:#FFFFFF}
    .pkt-label{paint-order:stroke;stroke:#0A0D11;stroke-width:3px;stroke-linejoin:round}`
  declare runtime?: Runtime
  declare catalog: Catalog
  declare platform: string
  declare system: string
  declare flipped: boolean
  s: State = { ry: 0, rx: 0, dragging: false, mode: 'relay', sel: null, depth: 64, editing: false, entering: false, leaving: false, zoom: 1, panX: 0, panY: 0, zooming: false, cord: null, armed: null, selMod: null, lift: null, toast: null, packets: [], hits: {}, flashes: {}, stats: {} }
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
    this.catalog = {}; this.platform = 'platform'; this.system = 'host'; this.flipped = false
    this.addEventListener('dock:connections', () => { if (this.flipped) this.close(); else this.flipped = true })
  }
  connectedCallback() { super.connectedCallback(); loadFonts(this.ownerDocument); if (this.hasUpdated) this.#attach() }
  disconnectedCallback() { super.disconnectedCallback(); this.#detach(); this.#stop() }
  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('runtime')) { this.#detach(); this.#attach() }
    if (changed.has('flipped')) this.flipped ? this.#open() : this.#close()
  }
  render() { return renderRoot(this) }

  /** React-style setState: merges a patch and re-renders. */
  setState(patch: Partial<State>) {
    if ('ry' in patch || 'rx' in patch) patch = { zooming: false, ...patch }   // camera moves ease again
    this.s = { ...this.s, ...patch }; this.requestUpdate()
  }
  /** Zooms by a factor (kept within 0.25–4), about a client point if given, so what is under it stays put. */
  zoomBy(factor: number, at?: { clientX: number; clientY: number }) {
    const { zoom, panX, panY } = this.s, next = Math.min(4, Math.max(0.25, zoom * factor))
    if (!at) return this.setState({ zoom: next, zooming: false })
    const r = this.renderRoot.querySelector('.world')?.getBoundingClientRect()
    const k = 1 - next / zoom, cx = r ? r.left + r.width / 2 : 0, cy = r ? r.top + r.height / 2 : 0
    this.setState({ zoom: next, panX: panX + k * (at.clientX - cx), panY: panY + k * (at.clientY - cy), zooming: true })
  }
  /** Pinch or ctrl/cmd+scroll zooms about the pointer; scrolling pans. */
  onWheel(e: WheelEvent) {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) this.zoomBy(Math.exp(-e.deltaY * 0.01), e)
    else this.setState({ panX: this.s.panX - e.deltaX, panY: this.s.panY - e.deltaY, zooming: true })
  }
  /** Back to the fitted view. */
  fit() { this.setState({ zoom: 1, panX: 0, panY: 0, zooming: false }) }
  now() { return performance.now() }
  recent(at: number | undefined) { return at !== undefined && this.now() - at < FLASH_MS }
  /** The slotted dock. */
  dock() { return this.firstElementChild as HTMLElement | null }

  #attach() {
    const rt = this.runtime
    if (!rt || !this.isConnected || this.#off.length) return
    this.#off = [rt.registry.listen(() => this.schedule()), rt.listen(t => this.trace(t))]
    this.rebuild()
  }
  #detach() { this.#off.forEach(f => f()); this.#off = [] }

  /** Rebuilds the model once, after the current burst of registry changes; only while flipped (opening rebuilds). */
  schedule() { if (!this.flipped) return; if (!this.#pending) { this.#pending = true; queueMicrotask(() => { this.#pending = false; this.rebuild() }) } }
  panels(): Panel[] {
    const dock = this.dock()
    if (!dock) return []
    // only panels that are showing: an inactive tab has no size or place, and its component waits in the rack
    return [...dock.querySelectorAll<HTMLElement>('.dock-panel')].filter(p => p.offsetWidth > 0 && p.offsetHeight > 0).map(p => {
      const el = modelIn(p)
      return { instance: el?.model ?? null, rect: rectIn(p, dock), tag: (el ?? p.firstElementChild ?? p).localName }
    })
  }
  rebuild() {
    const rt = this.runtime
    if (!rt) return
    const snapshot = rt.registry.snapshot(), panels = this.panels(), kinds: Record<string, string> = {}
    for (const i of snapshot.instances) { const k = this.kindOf(i.id); if (k) kinds[i.id] = k }
    const titles = Object.fromEntries(Object.entries(this.catalog).map(([k, e]) => [k, e.title]))
    this.#layout = JSON.stringify(panels)
    this.model = buildModel({ snapshot, panels, W: this.model.W, H: this.model.H, platform: this.platform, kinds, titles })
    this.puzzle = buildPuzzle(this.model)
    this.requestUpdate()
  }
  /** The catalog kind an instance was made from: the entry whose component is the instance's. */
  kindOf(id: string) {
    const c = this.runtime?.registry.get(id)?.component
    return c ? Object.keys(this.catalog).find(k => this.catalog[k]!.component === c) : undefined
  }

  /** A delivery on a drawn wire sends a packet along it, flashes its source and counts it. */
  trace(t: Trace) {
    if (!this.flipped || t.kind !== 'delivery' || !this.model.wires.some(w => w.id === t.subscription)) return   // flat: nothing to draw
    const now = this.now(), { stats, flashes } = this.s
    const stat = (id: string) => stats[id] ?? { in: 0, out: 0 }
    let label: string
    try { label = short(JSON.stringify(t.data) ?? String(t.data), 12) } catch { label = '…' }
    this.setState({
      packets: [...this.s.packets, { id: packetId++, wire: t.subscription, born: now, label }].slice(-MAX_PACKETS),
      flashes: { ...flashes, [t.from.instance]: now },
      stats: { ...stats, [t.from.instance]: { ...stat(t.from.instance), out: stat(t.from.instance).out + 1 }, [t.target]: { ...stat(t.target), in: stat(t.target).in + 1 } },
    })
  }
  /** Each frame: packets that arrived flash their target; a changed dock layout rebuilds the model. */
  frame() {
    const now = this.now(), arrived = this.s.packets.filter(p => now - p.born >= TRAVEL_MS)
    if (arrived.length) {
      const hits = { ...this.s.hits }
      for (const p of arrived) { const w = this.model.wires.find(x => x.id === p.wire); if (w) hits[this.model.P[w.to]!.owner] = now }
      this.setState({ packets: this.s.packets.filter(p => !arrived.includes(p)), hits })
    }
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
  ok(text: string) { this.setState({ cord: null, toast: { kind: 'ok', text } }) }
  fail(text: string) { this.setState({ cord: null, toast: { kind: 'err', text } }) }

  /** Calls a platform op as the view; a refusal is shown, and returned. */
  async call(op: Op, arg: unknown): Promise<Result> {
    if (!this.runtime) return { error: 'no runtime' }
    const r = await this.runtime.call({ registry: this.system, instance: 'wires' }, this.platform, Ops.key(op), arg)
    if ('error' in r) this.fail(r.error)
    return r
  }
  async connect(from: string, to: string) {
    const a = this.model.P[from]!, b = this.model.P[to]!
    return this.call(PlatformOps.connect, { system: this.system, source: a.owner, op: Ops.key(a.op), listener: b.owner, target: Ops.key(b.op) })
  }
  disconnect(id: string) { return this.call(PlatformOps.disconnect, { system: this.system, id }) }
  removeComponent(instance: string) { return this.call(PlatformOps.removeFromSystem, { instance, system: this.system }) }
  /** Adds a component of `kind` to the rack, under a fresh name; returns the name, or null if refused. */
  async create(kind: string) {
    let n = 1
    while (this.runtime?.registry.get(kind + '-' + n)) n += 1
    const r = await this.call(PlatformOps.createComponent, { kind, name: kind + '-' + n, system: this.system })
    return 'error' in r ? null : kind + '-' + n
  }
  /** Asks the workspace to open a rack component as a panel again, with the element of the kind it was made from. */
  openPanel(name: string) {
    const kind = this.kindOf(name)
    if (!kind) { this.fail(name + ' has no element to open'); return }
    this.dispatchEvent(new CustomEvent('wires:open-panel', { detail: { kind, name }, bubbles: true, composed: true }))
    this.ok('Opened ' + name + ' on the front')
  }
}

/** Registers <c-wires>. */
export const defineWires = () => { if (!customElements.get('c-wires')) customElements.define('c-wires', Wires) }
