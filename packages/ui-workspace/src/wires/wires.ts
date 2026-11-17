// <c-wires>: the prototype's Component class as a Lit element over the live app. It holds the view state, keeps
// the model in step with the app's deployment and the dock's layout, turns `sent` pipe messages into packets, and edits
// the app by applying its deployment with a pod or pipe added or removed. The render-* files draw it, as the
// prototype's template does from renderVals.
import { LitElement, css } from 'lit'
import type { AppDeployment, AppEvent } from '@pritzlaff/nano-core'
import type { Host } from '../host.ts'
import { addPod } from '../dock/panels.ts'
import { FLASH_MS, FONTS, FRAME_MS, MAX_PACKETS, TRAVEL_MS, TURN_MS, VIEWS, short, type View } from './constants'
import { buildModel, jacksOfImpl, snapshotOf, wireId, type Jack, type Model, type Panel } from './model'
import { buildPuzzle } from './puzzle'
import { renderRoot } from './render-root'

/** A cord being dragged: from `anchor`, maybe picked off a plugged input (`picked` is that wire). */
export type Cord = { anchor: string; picked: string | null; x: number; y: number; hover: string | null; err: string | null }
/** A message in flight along a wire (a subscription), from a trace delivery. */
export type Packet = { id: number; wire: string; born: number; label: string }
/** What is selected: a pod, or one of its ports (`system` is the runtime shown). */
export type Selection = { system: string; instance: string; op?: string } | null
/** An edit's outcome, as the old Application's: a value, or a refusal. */
export type Result = { value?: unknown } | { error: string }
/** What the host can make: an implementation's title and jacks, by its coordinate. */
export type Catalog = Record<string, { title: string; jacks: Jack[] }>
/** All of the view's state. */
export interface State {
  ry: number; rx: number; dragging: boolean; mode: 'relay' | 'puzzle'; sel: string | null; depth: number; editing: boolean; entering: boolean; leaving: boolean; hl: boolean
  /** Zoom (1 = fitted) and pan (screen px) on top of the camera; `zooming` makes them follow the wheel without easing. */
  zoom: number; panX: number; panY: number; zooming: boolean
  /** The drawer's tab, and what is selected (the Application's selection, kept in step through the trace). */
  tab: 'view' | 'detail'; picked: Selection
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
/** A panel's instance: the pod of the first element inside it whose view target names one. */
const modelIn = (panel: Element) => [...panel.querySelectorAll('*')].find(e => typeof (e as { target?: { pod?: unknown } }).target?.pod === 'string') as (Element & { target: { pod: string } }) | undefined
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
  static properties = { host: { attribute: false }, application: {}, system: {}, flipped: { type: Boolean, reflect: true } }
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
  /** The page's host: its app, registry and deployment. */
  declare host?: Host
  /** The host's own pod, never shown. */
  declare application: string
  declare system: string
  declare flipped: boolean
  s: State = { ry: 0, rx: 0, dragging: false, mode: 'relay', sel: null, depth: 64, editing: false, entering: false, leaving: false, hl: false, zoom: 1, panX: 0, panY: 0, zooming: false, tab: 'view', picked: null, cord: null, armed: null, selMod: null, lift: null, toast: null, packets: [], hits: {}, flashes: {}, stats: {} }
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
    this.#off = [h.app.listen(e => { if (e.type === 'applied') this.schedule(); else this.trace(e) })]
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
      const el = modelIn(p), id = el?.target.pod ?? null
      return { instance: id, rect: rectIn(p, dock), tag: (el ?? p.firstElementChild ?? p).localName }
    })
  }
  rebuild() {
    const h = this.host
    if (!h) return
    const snapshot = snapshotOf(h.data(), h.registry), panels = this.panels(), kinds: Record<string, string> = {}
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
  get catalog(): Catalog {
    const h = this.host
    if (!h) return {}
    return Object.fromEntries(h.registry.manifest().providers.filter(p => p.coord !== 'workspace.host').flatMap(p => p.implementations.map(c =>
      [c, { title: c.slice(c.indexOf('/') + 1), jacks: jacksOfImpl(h.registry.implementation(c)) }])))
  }

  /** A pipe message on a drawn wire sends a packet along it, flashes its source and counts it. */
  trace(t: AppEvent) {
    if (!this.flipped || t.type !== 'sent' || t.kind !== 'pipe') return   // flat: nothing to draw
    const prefix = `${t.runtime}|${t.from}|${t.to}|${t.port}|`, wire = this.model.wires.find(w => w.id.startsWith(prefix))
    if (!wire) return
    const now = this.now(), { stats, flashes } = this.s
    const stat = (id: string) => stats[id] ?? { in: 0, out: 0 }
    // BACKLOG(6): a `sent` event carries no data, so the packet is labelled with the target op, not the value.
    const label = short(t.port.slice(t.port.lastIndexOf('/') + 1), 12)
    this.setState({
      packets: [...this.s.packets, { id: packetId++, wire: wire.id, born: now, label }].slice(-MAX_PACKETS),
      flashes: { ...flashes, [t.from]: now },
      stats: { ...stats, [t.from]: { ...stat(t.from), out: stat(t.from).out + 1 }, [t.to]: { ...stat(t.to), in: stat(t.to).in + 1 } },
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

  /** The system shown: `system`, or the host's runtime `main`. */
  get sys() { return this.system || 'main' }
  /** Applies the deployment `edit` makes of the live one; a refusal is shown, and returned. */
  async change(edit: (d: AppDeployment) => AppDeployment | string, value?: unknown): Promise<Result> {
    const h = this.host
    if (!h) return { error: 'no host' }
    const next = edit(structuredClone(h.data()))
    const r = typeof next === 'string' ? { ok: false as const, fail: { reason: next } } : await h.apply(next)
    if (!r.ok) { this.fail(r.fail.reason); return { error: r.fail.reason } }
    return { value }
  }
  /** Adds a pipe from an out jack to an in jack, in a runtime both pods are placed in; its value is `{ id }`. */
  connect(from: string, to: string) {
    const a = this.model.P[from]!, b = this.model.P[to]!, pipe = { kind: 'pipe' as const, from: a.owner, source: a.port, to: b.owner, target: b.port }
    const rt = Object.keys(this.host?.data().runtimes ?? {}).find(r => [a.owner, b.owner].every(p => this.host!.data().runtimes[r]!.pods.includes(p)))
    return this.change(d => rt ? (d.runtimes[rt]!.subscriptions.push(pipe), d) : a.owner + ' and ' + b.owner + ' are not in one runtime', rt && { id: wireId(rt, pipe) })
  }
  /** Removes the pipe a wire id names. */
  disconnect(id: string) {
    const [rt, from, to, target, source] = id.split('|')
    return this.change(d => {
      const r = d.runtimes[rt!]
      if (r) r.subscriptions = r.subscriptions.filter(s => !(s.kind === 'pipe' && s.from === from && s.to === to && s.target === target && s.source === source))
      return d
    })
  }
  /** Removes a pod, from every runtime, with its pipes and edges. */
  removeComponent(instance: string) {
    return this.change(d => {
      delete d.pods[instance]; delete d.views?.[instance]; delete d.tags?.[instance]
      for (const r of Object.values(d.runtimes)) { r.pods = r.pods.filter(p => p !== instance); r.subscriptions = r.subscriptions.filter(s => s.from !== instance && s.to !== instance) }
      return d
    })
  }
  /** Adds a pod of `kind` (an implementation) to runtime main, under a fresh name; returns the name, or null if refused. */
  async create(kind: string) {
    const name = this.host && await addPod(this.host, kind)
    if (!name) this.fail('Could not add a ' + kind)
    return name ?? null
  }
  /** Asks the workspace to open a rack component as a panel again: the dock's panel for that pod. */
  openPanel(name: string) {
    const kind = this.kindOf(name)
    if (!kind) { this.fail(name + ' has no element to open'); return }
    this.dispatchEvent(new CustomEvent('wires:open-panel', { detail: { kind, name }, bubbles: true, composed: true }))
    this.ok('Opened ' + name + ' on the front')
  }
}

/** Registers <c-wires>. */
export const defineWires = () => { if (!customElements.get('c-wires')) customElements.define('c-wires', Wires) }
