/**
 * `<nano-ring>`: the app as rings (ring.ts): each shown pod as its own view, the time machine's messages in flight as
 * dots between them. With the cursor in the past and still for 200 ms, the views are bound to an app rebuilt to it
 * (`shadowAt` through `create`), inert; at Live, to the live app again. A dot click seeks to its message.
 *
 *   ring.app = app; ring.registry = registry; ring.tm = tm; ring.store = store
 *   ring.create = d => Application.create(…, { deploymentPolicy: DeploymentPolicies.allowAll() })   // a shadow's own app
 *   ring.show = (pod, impl) => impl !== 'nano.ui/clock'
 */
import { LitElement, css, html, svg } from 'lit'
import type { AppDeployment, Application, NanoResult, Registry } from '@pritzlaff/nano-core'
import { views as defaults } from '../views/define.ts'
import { viewFor, type ViewTarget } from '../views/view.ts'
import type { MessageStore } from './entry.ts'
import { cleanStart } from './replay.ts'
import { ringDot, ringLayout, ringSource } from './ring.ts'
import { shadowAt } from './shadow.ts'
import type { Frame, TimeMachine } from './time-machine.ts'

const SIZE = 600, STILL_MS = 200
type View = HTMLElement & { target?: ViewTarget }

export class NanoRing extends LitElement {
  static properties = {
    app: { attribute: false }, registry: { attribute: false }, tm: { attribute: false }, store: { attribute: false }, create: { attribute: false }, show: { attribute: false },
    frame: { state: true }, shadow: { state: true }, tooLong: { state: true }, failed: { state: true },
  }
  static styles = css`
    :host { display: block; overflow: auto; color: #E6EDF3; font: 12px system-ui, sans-serif; background: #0B0E12 }
    .stage { position: relative; margin: 8px auto }
    svg { position: absolute; inset: 0; overflow: visible; pointer-events: none }
    circle.rt { fill: none; stroke: #2A323D; stroke-width: 2 } circle[data-dot] { pointer-events: all; cursor: pointer }
    .pod { position: absolute; transform: translate(-50%, -50%); width: 150px; max-height: 120px; overflow: auto; padding: 4px; border: 1px solid #2A323D; border-radius: 8px; background: #181E26 }
    .pod[inert] { opacity: .85; border-style: dashed } .pod > b { display: block; font-size: 11px; color: #94a3b8 }
    small.warn { display: block; padding: 6px 8px; color: #fbbf24 }`
  declare app?: Application; declare registry?: Registry; declare tm?: TimeMachine; declare store?: MessageStore
  declare create?: (d: AppDeployment) => Promise<NanoResult<Application>>
  declare show?: (pod: string, impl: string) => boolean
  declare frame?: Frame; declare shadow?: Application; declare tooLong: boolean; declare failed?: string
  private offs: (() => void)[] = []
  private views = new Map<string, View>()
  private timer?: ReturnType<typeof setTimeout>
  private still?: number
  private build = 0   // the latest rebuild; an older one's app is closed when it lands

  constructor() { super(); this.tooLong = false }
  connectedCallback() { super.connectedCallback(); this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); for (const off of this.offs.splice(0)) off(); this.toLive() }
  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('store') || changed.has('tm')) { this.tooLong = false; this.toLive() }
    if (changed.has('app') || changed.has('tm')) this.watch()
  }

  private watch() {
    for (const off of this.offs.splice(0)) off()
    if (!this.isConnected) return
    if (this.app) this.offs.push(this.app.listen(e => { if (e.type === 'applied') this.requestUpdate() }))
    if (this.tm) this.offs.push(this.tm.subscribe(f => { this.frame = f; this.sync() }))
    this.sync()
  }
  /** Live (or too long): the live app. Past: a rebuild once the cursor has been still for STILL_MS. */
  private sync() {
    const tm = this.tm
    if (!tm || ringSource(tm.mode, tm.cursor >= tm.span.to, !this.tooLong) !== 'past') return this.toLive()
    if (tm.cursor === this.still) return
    this.still = tm.cursor
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.rebuild(tm.cursor), STILL_MS)
  }
  private toLive() {
    clearTimeout(this.timer); this.still = undefined; this.build++; this.failed = undefined
    this.bind(undefined)
  }
  private bind(shadow: Application | undefined) {
    const old = this.shadow
    this.shadow = shadow
    if (old && old !== shadow) void old.close()
  }
  private async rebuild(t: number) {
    const mine = ++this.build, store = this.store, create = this.create
    if (!store || !create) return
    if (!(await cleanStart(store))) { if (mine === this.build) { this.tooLong = true; this.toLive() } return }
    const made = await shadowAt(store, t, create)
    if (mine !== this.build) { if (made.ok) await made.value.close(); return }
    if (made.ok) { this.failed = undefined; this.bind(made.value) } else { this.failed = made.fail.reason; this.bind(undefined) }
  }

  /** The pod's view element, kept across renders, its target set when it changes. */
  private view(d: AppDeployment, pod: string, runtime: string, app: Application, registry: Registry) {
    const tag = viewFor(pod, d, defaults), key = `${pod} ${tag}`
    let el = this.views.get(key)
    if (!el) this.views.set(key, el = document.createElement(tag) as View)
    const t = el.target
    if (!t || t.app !== app || t.runtime !== runtime || t.registry !== registry) el.target = { app, registry, runtime, pod }
    return el
  }

  render() {
    const { app, registry, tm } = this
    if (!app || !registry) return html``
    const d = app.deployment(), l = ringLayout(d, { size: SIZE, show: this.show }), bound = this.shadow ?? app, past = !!this.shadow
    const tooLong = !!tm && this.tooLong && ringSource(tm.mode, tm.cursor >= tm.span.to, false) === 'too-long'
    const home = (pod: string, rt: string | null) => rt ?? Object.keys(d.runtimes).find(r => d.runtimes[r]!.pods.includes(pod))!
    const dots = (this.frame?.inFlight ?? []).flatMap(({ message, progress }) => {
      const p = ringDot(l, d, message, Math.min(1, progress))
      return p ? [svg`<circle data-dot=${message.sent.id} cx=${p.x} cy=${p.y} r="6" fill="#F5B73B" stroke="#0B0E12" stroke-width="2" @click=${() => tm?.seek(message.at)}></circle>`] : []
    })
    return html`
      ${tooLong ? html`<small class="warn">history too long to rebuild state</small>` : ''}
      ${this.failed ? html`<small class="warn">${this.failed}</small>` : ''}
      <div class="stage" style="width:${SIZE}px;height:${SIZE}px">
        <svg>${l.runtimes.map(r => svg`<circle class="rt" cx=${r.x} cy=${r.y} r=${r.r}></circle><text x=${r.x} y=${r.y - r.r - 8} text-anchor="middle" fill="#94a3b8">${r.id}</text>`)}</svg>
        ${l.pods.map(p => html`<div class="pod" data-pod=${p.pod} .inert=${past} style="left:${p.x}px;top:${p.y}px"><b>${p.pod}</b>${this.view(d, p.pod, home(p.pod, p.runtime), bound, registry)}</div>`)}
        <svg>${dots}</svg>
      </div>`
  }
}
