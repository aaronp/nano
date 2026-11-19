// `<raft-node>`: the node glyph of raft.github.io: a circle with the term, coloured by role, an arc of election time
// left and a dot per peer (hollow while a reply is pending, filled once a vote was granted). A click opens its detail.
import { LitElement, css, html, svg } from 'lit'
import { base } from '@pritzlaff/nano-elements'
import { Clock, type ViewTarget } from '@pritzlaff/nano-ui'
import type { Node } from '../core/types.ts'
import { RaftNode } from '../interfaces.ts'
import './detail.ts'
import { glyphModel } from './model.ts'

const COLOUR = { follower: '#8b949e', candidate: '#F5A524', leader: '#7EE787' }
const R = 40, TAU = 2 * Math.PI

class RaftNodeView extends LitElement {
  static properties = { target: { attribute: false }, status: { state: true }, now: { state: true }, open: { state: true } }
  static styles = [base, css`svg { cursor: pointer; width: 120px; height: 120px } text { fill: currentColor; text-anchor: middle; font-size: 22px }`]
  declare target?: ViewTarget
  declare status?: Node
  declare now: number
  declare open: boolean
  private stop?: () => void
  private watching?: ViewTarget
  constructor() { super(); this.now = 0; this.open = false }

  connectedCallback() { super.connectedCallback(); this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.stop?.(); this.stop = this.watching = undefined }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) this.watch() }

  private watch() {
    const t = this.target
    if (!t || !this.isConnected || this.watching === t) return
    this.stop?.()
    this.watching = t
    this.status = undefined; this.now = 0   // a new target (a shadow app, say) starts from nothing
    const rt = t.app.runtime(t.runtime), heard = { status: false, now: false }   // read once, then hear: `changed` carries the status, `fired` its time
    const offs = [rt.subscribe(RaftNode.ops.changed, ({ output }) => { heard.status = true; this.status = output }),
      rt.subscribe(Clock.ops.fired, ({ output }) => { heard.now = true; this.now = output.at })]
    this.stop = () => offs.forEach(off => off())
    // the read applies only for what no event has already told (an event is newer than the read), and never after a swap
    void Promise.all([rt.get(RaftNode, { pod: t.pod }).status(), rt.get(Clock).now()]).then(([status, now]) => {
      if (this.watching !== t) return
      if (!heard.status) this.status = status
      if (!heard.now) this.now = now
    }, () => {})
  }
  render() {
    if (!this.status) return html``
    const m = glyphModel(this.status, this.now), c = COLOUR[m.role], k = TAU * R
    const dots = m.peers.map((p, i) => { const a = TAU * i / m.peers.length - Math.PI / 2
      return svg`<circle class="dot ${p.state}" cx=${60 + 52 * Math.cos(a)} cy=${60 + 52 * Math.sin(a)} r="5" stroke=${c} stroke-opacity=${p.state === 'idle' ? 0.2 : 1} fill=${p.state === 'granted' ? c : 'none'}><title>${p.id}: ${p.state}</title></circle>` })
    return html`<svg viewBox="0 0 120 120" opacity=${m.stopped ? 0.35 : 1} @click=${() => { this.open = !this.open }}>
        <circle cx="60" cy="60" r=${R} fill="none" stroke=${c} stroke-opacity="0.25" stroke-width="6"/>
        <circle class="arc" cx="60" cy="60" r=${R} fill="none" stroke=${c} stroke-width="6" stroke-dasharray="${m.arc * k} ${k}" transform="rotate(-90 60 60)"/>
        <text x="60" y="68">${m.term}</text>${dots}</svg>
      ${this.open ? html`<raft-detail .target=${this.target} .status=${this.status} .now=${this.now}></raft-detail>` : ''}`
  }
}
if (!customElements.get('raft-node')) customElements.define('raft-node', RaftNodeView)
