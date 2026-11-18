// <c-desk>: the app as runtime boxes of pod columns with cords between jacks. Rebuilds on an `applied`; the layout is
// held here (`layout()` for Save). Drag a runtime by its header or a column by its body; on release, push the siblings.
import { LitElement, css, html } from 'lit'
import type { Host } from '../host.ts'
import { empty as emptyWires } from '../wires/state'
import { toggle, type ViewSettings } from '../wires/filter'
import { align, arrange, GRID, push, readLayout, setSnap, type DeskLayout, type XY } from './arrange'
import { renderCords } from './cords'
import { deskModel, type DeskModel } from './model'
import { fitting, keyOf, patch, unplug, type Sel } from './edit'
import { renderRuntimes } from './render'

const empty: DeskModel = { runtimes: [], pipes: [], calls: [], rank: {}, wires: emptyWires() }

export class Desk extends LitElement {
  static properties = { host: { attribute: false }, application: {}, editing: { state: true }, sel: { state: true } }
  static styles = css`
    :host { display: block; height: 100%; min-height: 360px; color: #E6EDF3; font: 12px system-ui, sans-serif; background: #0B0E12 }
    .bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; align-items: center }
    button { padding: 4px 10px; border: 1px solid #2A323D; border-radius: 999px; background: #12161C; color: inherit; font: inherit; cursor: pointer }
    button[aria-pressed="true"] { border-color: #4CC2FF; color: #4CC2FF }
    .stage { position: relative; overflow: auto; height: calc(100% - 44px) }
    [data-snap] { position: absolute; inset: 0; background: radial-gradient(#1C222B 1px, transparent 1px) 0 0 / 20px 20px; pointer-events: none }
    .rt { position: absolute; box-sizing: border-box; border: 2px solid var(--c); border-radius: 10px; background: color-mix(in srgb, var(--c) 7%, #0B0E12) }
    .rt > h3 { margin: 0; padding: 6px 10px; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--c); cursor: grab; user-select: none; touch-action: none }
    .col { position: absolute; box-sizing: border-box; border: 1px solid #2A323D; border-radius: 8px; background: #181E26; cursor: grab; user-select: none; touch-action: none; overflow: hidden }
    h4 { margin: 0; padding: 6px 8px 2px; font-size: 13px } small { display: block; padding: 0 8px 6px; color: #94a3b8; font-size: 11px; border-bottom: 1px solid #2A323D; height: 14px }
    .row { display: flex; justify-content: space-between; align-items: center; padding: 0 8px }
    .jack { display: flex; gap: 6px; align-items: center } .jack.out { flex-direction: row-reverse }
    .jack[data-event] { font-style: italic; color: #94a3b8 }
    .jack i { width: 8px; height: 8px; border-radius: 50%; background: #4CC2FF }
    [data-fits] i { box-shadow: 0 0 0 3px #4CC2FF88 } [data-selected] i { background: #fff }
    [data-toast] { position: absolute; right: 8px; bottom: 8px; padding: 6px 10px; border-radius: 6px; background: #3b1219; color: #fecaca }
    path[data-pipe] { pointer-events: stroke; cursor: pointer }
    svg { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none }`
  declare host?: Host
  declare application: string
  view: ViewSettings = { show: 'connected', pills: { runtimes: [], pods: [] } }
  #m = empty
  #l: DeskLayout = readLayout(undefined)
  #a = arrange(empty, this.#l)
  #off: (() => void)[] = []
  editing = false
  sel: Sel = null
  #toast = ''
  #pending = false
  #read = false

  constructor() { super(); this.application = 'ui' }
  /** The current arrangement, for Save. */
  layout(): DeskLayout { return this.#l }

  connectedCallback() { super.connectedCallback(); window.addEventListener('keydown', this.#key); if (this.hasUpdated) this.#attach() }
  disconnectedCallback() { super.disconnectedCallback(); window.removeEventListener('keydown', this.#key); this.#detach() }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('host')) { this.#detach(); this.#read = false; this.#attach() } }
  #attach() {
    const h = this.host
    if (!h || !this.isConnected || this.#off.length) return
    this.#off = [h.app.listen(e => { if (e.type === 'applied') this.#schedule() })]
    this.#schedule()
  }
  #detach() { this.#off.forEach(f => f()); this.#off = [] }
  #schedule() { if (!this.#pending) { this.#pending = true; queueMicrotask(() => { this.#pending = false; this.#load() }) } }
  #load() {
    const h = this.host
    if (!h || !this.#off.length) return
    const d = h.data()
    if (!this.#read) { this.#read = true; this.#l = readLayout((d as any).layout?.desk) }
    this.#m = deskModel(d, h.registry, h.calls?.() ?? [], this.view, this.application)
    this.#fit()
  }
  #fit() { this.#a = arrange(this.#m, this.#l); this.#l = this.#a.layout; this.requestUpdate() }
  #set(l: DeskLayout) { this.#l = l; this.#fit() }
  #view(v: ViewSettings) { this.view = v; this.#load() }

  #put(runtime: string, pod: string | undefined, p: Record<string, XY>) {
    const l = this.#l
    this.#set(pod === undefined ? { ...l, runtimes: { ...l.runtimes, ...p } } : { ...l, pods: { ...l.pods, [runtime]: { ...l.pods[runtime], ...p } } })
  }
  #down = (e: PointerEvent, runtime: string, pod?: string) => {
    e.stopPropagation()
    const start = pod === undefined ? this.#a.runtimes[runtime]! : this.#a.columns[runtime]![pod]!, x0 = e.clientX, y0 = e.clientY
    const to = (v: number) => this.#l.snap ? Math.round(v / GRID) * GRID : v
    const move = (m: PointerEvent) => this.#put(runtime, pod, { [pod ?? runtime]: { x: to(start.x + m.clientX - x0), y: to(start.y + m.clientY - y0) } })
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      if (pod !== undefined) this.#put(runtime, pod, push(this.#a.columns[runtime]!, pod, this.#l.snap))
      this.#put(runtime, undefined, push(this.#a.runtimes, runtime, this.#l.snap))
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }

  #select(sel: Sel, toast = '') { this.sel = sel; this.#toast = toast; this.requestUpdate() }
  #remove() { const h = this.host, s = this.sel; if (h && s && 'pipe' in s) unplug(h, s.pipe).then(e => this.#select(e ? s : null, e ?? '')) }
  #key = (e: KeyboardEvent) => {
    if (!this.editing) return
    if (e.key === 'Escape') this.#select(null)
    else if (e.key === 'Delete' || e.key === 'Backspace') this.#remove()
  }
  #click(e: MouseEvent) {
    if (!this.editing) return
    const t = e.target as Element, j = t.closest?.('[data-jack]')?.getAttribute('data-jack'), w = t.closest?.('[data-pipe]')?.getAttribute('data-pipe')
    if (w) return this.#select({ pipe: w })
    if (!j) return this.#select(null)
    const s = this.sel, h = this.host
    if (!s || !('jack' in s) || !h) return this.#select({ jack: j })
    patch(h, this.#m.wires, s.jack, j).then(err => this.#select(err ? s : null, err ?? ''))
  }

  render() {
    const d = this.host?.data(), { show, pills } = this.view, pill = (k: 'runtimes' | 'pods', id: string) => html`<button data-pill=${k} data-id=${id} aria-pressed=${pills[k].includes(id)} @click=${() => this.#view({ show, pills: { ...pills, [k]: toggle(pills[k], id) } })}>${id}</button>`
    const l = this.#l, W = Math.max(0, ...Object.values(this.#a.runtimes).map(r => r.x + r.w)), H = Math.max(0, ...Object.values(this.#a.runtimes).map(r => r.y + r.h))
    return html`<div class="bar">
      ${(['connected', 'all'] as const).map(s => html`<button data-show=${s} aria-pressed=${show === s} @click=${() => this.#view({ show: s, pills })}>${s === 'all' ? 'All' : 'Connected'}</button>`)}
      ${Object.keys(d?.runtimes ?? {}).map(id => pill('runtimes', id))}${Object.keys(d?.pods ?? {}).filter(p => p !== this.application).map(id => pill('pods', id))}
      <button data-snap-toggle aria-pressed=${l.snap} @click=${() => this.#set(setSnap(l, !l.snap))}>Snap</button>
      <button data-compact aria-pressed=${l.compact} @click=${() => this.#set({ ...l, compact: !l.compact })}>Compact</button>
      <button data-align @click=${() => this.#set(align(this.#m, l))}>Align</button>
      <button data-edit aria-label="Edit" aria-pressed=${this.editing} @click=${() => { this.editing = !this.editing; this.#select(null) }}>&#9998;</button>
      ${this.sel && 'pipe' in this.sel ? html`<button data-remove @click=${() => this.#remove()}>Remove</button>` : ''}
    </div>
    <div class="stage" @click=${(e: MouseEvent) => this.#click(e)}>${l.snap ? html`<div data-snap></div>` : ''}${renderRuntimes(this.#m, this.#a, l, this.#down, { sel: this.sel && 'jack' in this.sel ? this.sel.jack : undefined, fits: this.sel && 'jack' in this.sel ? fitting(this.#m.wires, keyOf(this.sel.jack)) : new Set() })}
      <svg width=${W} height=${H}>${renderCords(this.#m, this.#a, l)}</svg>${this.#toast ? html`<div data-toast>${this.#toast}</div>` : ''}</div>`
  }
}

/** Defines `<c-desk>` once. */
export function defineDesk() { if (!customElements.get('c-desk')) customElements.define('c-desk', Desk) }
