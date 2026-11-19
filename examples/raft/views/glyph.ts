// `<raft-node>`: the node glyph of raft.github.io: a circle with the term, coloured by role, an arc of election time
// left and a dot per peer (hollow while a reply is pending, filled once a vote was granted). A click opens its detail.
import { LitElement, css, html, svg } from 'lit'
import { base } from '@pritzlaff/nano-elements'
import { Clock, type ViewTarget } from '@pritzlaff/nano-ui'
import type { Node } from '../core/types.ts'
import { RaftNode } from '../interfaces.ts'
import './detail.ts'
import { follow } from './follow.ts'
import { glyphModel } from './model.ts'

const COLOUR = { follower: '#8b949e', candidate: '#F5A524', leader: '#7EE787' }
const R = 40, TAU = 2 * Math.PI

export class RaftNodeView extends LitElement {
  static properties = { target: { attribute: false }, status: { state: true }, now: { state: true }, open: { state: true } }
  static styles = [base, css`svg { cursor: pointer; width: 120px; height: 120px } text { fill: currentColor; text-anchor: middle; font-size: 22px }`]
  declare target?: ViewTarget
  declare status?: Node
  declare now: number
  declare open: boolean
  private stop?: () => void
  private watching?: ViewTarget
  private seq = 0
  constructor() { super(); this.now = 0; this.open = false }

  connectedCallback() { super.connectedCallback(); this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.stop?.(); this.stop = this.watching = undefined }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) this.watch() }

  private watch() {
    const t = this.target
    if (!t || !this.isConnected || this.watching === t) return
    this.stop?.()
    this.watching = t
    this.stop = follow(t, async () => {
      const at = ++this.seq, rt = t.app.runtime(t.runtime)
      const [status, now] = await Promise.all([rt.get(RaftNode, { pod: t.pod }).status(), rt.get(Clock).now()]).catch(() => [])
      if (at === this.seq && status) { this.status = status; this.now = now! }
    })
  }
  render() {
    if (!this.status) return html``
    const m = glyphModel(this.status, this.now), c = COLOUR[m.role], k = TAU * R
    const dots = m.peers.map((p, i) => { const a = TAU * i / m.peers.length - Math.PI / 2
      return svg`<circle class="dot ${p.state}" cx=${60 + 52 * Math.cos(a)} cy=${60 + 52 * Math.sin(a)} r="5" stroke=${c} fill=${p.state === 'granted' ? c : 'none'}><title>${p.id}: ${p.state}</title></circle>` })
    return html`<svg viewBox="0 0 120 120" opacity=${m.stopped ? 0.35 : 1} @click=${() => { this.open = !this.open }}>
        <circle cx="60" cy="60" r=${R} fill="none" stroke=${c} stroke-opacity="0.25" stroke-width="6"/>
        <circle class="arc" cx="60" cy="60" r=${R} fill="none" stroke=${c} stroke-width="6" stroke-dasharray="${m.arc * k} ${k}" transform="rotate(-90 60 60)"/>
        <text x="60" y="68">${m.term}</text>${dots}</svg>
      ${this.open ? html`<raft-detail .target=${this.target} .status=${this.status} .now=${this.now}></raft-detail>` : ''}`
  }
}
if (!customElements.get('raft-node')) customElements.define('raft-node', RaftNodeView)
