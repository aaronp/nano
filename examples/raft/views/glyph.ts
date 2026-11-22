// `<raft-node>`: the node glyph of raft.github.io: a circle with the term, coloured by role, an arc of election time
// left and a dot per peer (hollow while a reply is pending, filled once a vote was granted). A click opens its detail in a dialog, a right-click its ops in a menu.
import { LitElement, css, html, svg } from 'lit'
import { base } from '@pritzlaff/nano-elements'
import { Clock, type ViewTarget } from '@pritzlaff/nano-ui'
import type { Node } from '../core/types.ts'
import { RaftNode } from '../interfaces.ts'
import { NODE_OPS, callNodeOp, type NodeOp } from './detail.ts'
import { glyphModel, paced } from './model.ts'

const COLOUR = { follower: '#8b949e', candidate: '#F5A524', leader: '#7EE787' }
const R = 40, TAU = 2 * Math.PI

class RaftNodeView extends LitElement {
  static properties = { target: { attribute: false }, status: { state: true }, now: { state: true }, open: { state: true }, menu: { state: true }, error: { state: true } }
  static styles = [base, css`svg { cursor: pointer; width: 120px; height: 120px } dialog { color: inherit; background: Canvas; padding: 0 } .pad { padding: 1em } .menu { position: fixed; display: flex; flex-direction: column; background: Canvas; border: 1px solid currentColor; z-index: 10 } text { fill: currentColor; text-anchor: middle; font-size: 22px }`]
  declare target?: ViewTarget
  declare status?: Node
  declare now: number
  declare open: boolean
  declare menu?: { x: number; y: number }
  declare error?: string
  private n = 0
  private close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.type === 'contextmenu' && e.composedPath().includes(this))) this.menu = undefined }
  private stop?: () => void
  private watching?: ViewTarget
  private pace?: ReturnType<typeof paced>   // the clock's pace, so the arc drains each frame between events (no calls)
  private frame = 0
  constructor() { super(); this.now = 0; this.open = false }

  /** Each frame, the arc as it is now by the clock's pace: a timeout drawn or a heartbeat heard restarts it, and it drains smoothly to the alarm. */
  private tick = () => {
    const arc = this.shadowRoot?.querySelector<SVGCircleElement>('circle.arc')
    if (arc && this.status) arc.setAttribute('stroke-dasharray', this.dash(this.status))
    this.frame = requestAnimationFrame(this.tick)
  }
  /** The arc's dash, by the clock's pace (the last event's time until there is one). */
  private dash(s: Node) { const p = this.pace, k = TAU * R; return `${glyphModel(s, p ? p.sim + (performance.now() - p.wall) * p.rate : this.now).arc * k} ${k}` }
  connectedCallback() { super.connectedCallback(); this.frame = requestAnimationFrame(this.tick); this.watch(); window.addEventListener('click', this.close); window.addEventListener('keydown', this.close); window.addEventListener('contextmenu', this.close) }
  disconnectedCallback() { super.disconnectedCallback(); cancelAnimationFrame(this.frame); window.removeEventListener('click', this.close); window.removeEventListener('keydown', this.close); window.removeEventListener('contextmenu', this.close); this.stop?.(); this.stop = this.watching = undefined }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) this.watch() }

  private watch() {
    const t = this.target
    if (!t || !this.isConnected || this.watching === t) return
    this.stop?.()
    this.watching = t
    this.status = undefined; this.now = 0; this.pace = undefined   // a new target (a shadow app, say) starts from nothing
    const heard = { status: false, now: false }, offs: (() => void)[] = []   // read once, then hear: `changed` carries the status, `fired` its time
    this.stop = () => offs.forEach(off => off())
    try {   // throws when the app has no such runtime or pod (a shadow from before the cluster): nothing to show
      const rt = t.app.runtime(t.runtime)
      offs.push(rt.subscribe(RaftNode.ops.changed, ({ output }) => { heard.status = true; this.status = output }))
      offs.push(rt.subscribe(Clock.ops.fired, ({ output }) => { heard.now = true; this.now = output.at; this.pace = paced(this.pace, output.at, performance.now()) }))
      // the read applies only for what no event has already told (an event is newer than the read), and never after a swap
      void Promise.all([rt.get(RaftNode, { pod: t.pod }).status(), rt.get(Clock).now()]).then(([status, now]) => {
        if (this.watching !== t) return
        if (!heard.status) this.status = status
        if (!heard.now) { this.now = now; this.pace = paced(this.pace, now, performance.now()) }
      }, () => {})
    } catch { /* empty */ }
  }
  updated() {
    const d = this.shadowRoot?.querySelector('dialog')
    if (d && !d.hasAttribute('open')) { if (d.showModal) d.showModal(); else d.setAttribute('open', '') }
  }
  private pick(op: NodeOp) { this.menu = undefined; void callNodeOp(this.target!, op, `v${++this.n}`).then(e => { this.error = e }) }
  private menuItem = (label: string, op: NodeOp) => html`<button class="btn small" role="menuitem" type="button" @click=${() => this.pick(op)}>${label}</button>`
  render() {
    if (!this.status) return html``
    const m = glyphModel(this.status, this.now), c = COLOUR[m.role]
    const dots = m.peers.map((p, i) => { const a = TAU * i / m.peers.length - Math.PI / 2
      return svg`<circle class="dot ${p.state}" cx=${60 + 52 * Math.cos(a)} cy=${60 + 52 * Math.sin(a)} r="5" stroke=${c} stroke-opacity=${p.state === 'idle' ? 0.2 : 1} fill=${p.state === 'granted' ? c : 'none'}><title>${p.id}: ${p.state}</title></circle>` })
    return html`<svg viewBox="0 0 120 120" opacity=${m.stopped ? 0.35 : 1} @click=${() => { this.open = true }} @contextmenu=${(e: MouseEvent) => { e.preventDefault(); this.error = undefined; this.menu = { x: e.clientX, y: e.clientY } }}>
        <circle cx="60" cy="60" r=${R} fill="none" stroke=${c} stroke-opacity="0.25" stroke-width="6"/>
        <circle class="arc" cx="60" cy="60" r=${R} fill="none" stroke=${c} stroke-width="6" stroke-dasharray=${this.dash(this.status)} transform="rotate(-90 60 60)"/>
        <text x="60" y="68">${m.term}</text>${dots}</svg>
      ${this.menu ? html`<div class="menu" role="menu" style="left: ${this.menu.x}px; top: ${this.menu.y}px">${NODE_OPS.map(([label, op]) => this.menuItem(label, op))}</div>` : ''}
      ${this.error ? html`<p class="alert bad" role="alert">${this.error}</p>` : ''}
      ${this.open ? html`<dialog @click=${(e: Event) => { if (e.target === e.currentTarget) this.open = false }} @cancel=${() => { this.open = false }} @keydown=${(e: KeyboardEvent) => { if (e.key === 'Escape') this.open = false }}>
        <div class="pad"><div class="row"><strong>${this.status.id}</strong><button class="btn small" type="button" aria-label="close" @click=${() => { this.open = false }}>✕</button></div>
        <raft-detail .target=${this.target} .status=${this.status} .now=${this.now}></raft-detail></div></dialog>` : ''}`
  }
}
if (!customElements.get('raft-node')) customElements.define('raft-node', RaftNodeView)
