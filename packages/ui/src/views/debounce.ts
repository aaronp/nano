/**
 * `nano-debounce`: the debounce animation over a nano.ui/debounce pod. Values it hears pushed wait in the switchback;
 * at a flush (the pod's `sent` from `batch`/`flushed`, or its deadline passing) they drop through the hatch into a
 * bucket, and buckets slide along as history. Quiet and max wait are sliders that apply the pod's config on release.
 */
import { css, html } from 'lit'
import { port, type AppEvent, type PodDeployment } from '@pritzlaff/nano-core'
import { Debounce } from '../interfaces.ts'
import { arrivalPos, bucketView, clamp01, colorOf, dueAt, flushTravel, G, label, reasonFor, slotXY, startFlush, tint, type Batch, type Flushing, type Queued } from './debounce-model.ts'
import { bucket, MONO, slider, track } from './debounce-parts.ts'
import { ViewElement, type ViewTarget } from './view.ts'

const PUSH = port(Debounce, Debounce.ops.push)
const BOX = { x: 90, w: 1090, h: 600 }
const REASON_COLOR = { quiet: 'var(--nano-muted, #9AA4B2)', 'max wait': 'var(--nano-warn, #E8B04B)' }
type Config = { quietMs?: number; maxWaitMs?: number }

export class NanoDebounce extends ViewElement {
  static styles = [...ViewElement.styles, css`:host { display: block; height: 100%; min-height: 160px }`]
  pending: Queued[] = []
  flushing: Flushing | null = null
  batches: Batch[] = []
  batchSeq = 0
  committed = 0
  lastCommitAt = -1e9
  /** A slider's value while it is dragged, before the config is applied. */
  private dragged: Config = {}
  private valued = false
  private unsub?: () => void
  private raf = 0
  private fit = { w: BOX.w, h: BOX.h }
  private ro?: ResizeObserver

  private config(tg: ViewTarget): Config { return { ...(tg.app.deployment().pods[tg.pod]?.config as Config | undefined), ...this.dragged } }
  private quiet(tg: ViewTarget) { return this.config(tg).quietMs ?? 300 }
  private maxWait(tg: ViewTarget) { return this.config(tg).maxWaitMs }

  /** Values come from `subscribe(push)` when this runtime has one debounce; else arrivals are counted from `sent`. */
  protected started(tg: ViewTarget) {
    this.unsub?.()
    try { this.unsub = tg.app.runtime(tg.runtime).subscribe(Debounce.ops.push, ({ input }) => this.arrive(input)); this.valued = true }
    catch { this.unsub = undefined; this.valued = false }
  }
  protected hear(e: AppEvent, tg: ViewTarget) {
    // a new config rebuilds the pod: its queue is gone, and so is the subscription to its pushes
    if (e.type === 'applied' && (e.changed.includes(tg.pod) || e.added.includes(tg.pod))) { this.pending = []; this.started(tg); return }
    if (e.type !== 'sent' || e.kind === 'subscribe' || e.kind === 'unsubscribe') return   // a subscribe is no value travelling
    if (!this.valued && e.to === tg.pod && e.port === PUSH) this.arrive('•')
    // what it sends is its flushes (a pipe names the target's port), except a subscriber's copy of a push (an `on` at push)
    else if (e.from === tg.pod && (e.kind === 'pipe' || e.kind === 'on') && e.port !== PUSH) this.flush(tg)
  }
  private arrive(value: unknown) { this.pending = [...this.pending, { value, at: Date.now() }]; this.requestUpdate() }
  private flush(tg: ViewTarget, now = Date.now()) {
    if (!this.pending.length) return
    if (this.flushing) this.commit(now)
    this.flushing = startFlush(this.pending, now, reasonFor(this.pending, this.quiet(tg), this.maxWait(tg)))
    this.pending = []
    this.requestUpdate()
  }
  private commit(now: number) {
    const f = this.flushing!
    this.batchSeq += 1; this.committed += f.events.length; this.lastCommitAt = now
    this.batches = [...this.batches, { id: this.batchSeq, events: f.events, reason: f.reason }].slice(-G.history)
    this.flushing = null
  }
  /** Applies the pod's config with `c` merged in (the pod restarts with it). */
  private async set(tg: ViewTarget, c: Config) {
    const d = tg.app.deployment(), p = d.pods[tg.pod]
    if (!p) return
    const config = { ...(p.config as Config | undefined), ...c }
    if (config.maxWaitMs === undefined) delete config.maxWaitMs
    const pods: PodDeployment = { ...d.pods, [tg.pod]: { ...p, config: { quietMs: 300, ...config } } }
    await tg.app.apply({ ...d, pods })
    this.dragged = {}; this.requestUpdate()
  }

  firstUpdated() {
    const box = this.renderRoot.querySelector<HTMLElement>('.fit')
    if (!box || typeof ResizeObserver === 'undefined') return
    this.ro = new ResizeObserver(() => { this.fit = { w: box.clientWidth, h: box.clientHeight }; this.requestUpdate() })
    this.ro.observe(box)
  }
  connectedCallback() { super.connectedCallback(); const box = this.renderRoot?.querySelector?.('.fit'); if (box) this.ro?.observe(box) }   // re-attached: fit again
  disconnectedCallback() { super.disconnectedCallback(); this.unsub?.(); this.unsub = undefined; this.ro?.disconnect(); cancelAnimationFrame(this.raf); this.raf = 0 }
  willUpdate(changed: Map<string, unknown>) {
    super.willUpdate(changed)
    const now = Date.now(), tg = this.target
    if (tg && this.pending.length && now >= dueAt(this.pending, this.quiet(tg), this.maxWait(tg)) + 40) this.flush(tg, now)   // no sent seen (nothing piped)
    if (this.flushing && now >= this.flushing.doneAt) this.commit(now)
  }
  updated() {
    const busy = this.pending.length > 0 || this.flushing !== null || Date.now() - this.lastCommitAt < G.slideMs
    if (busy && !this.raf && typeof requestAnimationFrame !== 'undefined') this.raf = requestAnimationFrame(() => { this.raf = 0; this.requestUpdate() })
  }

  protected face(tg: ViewTarget) {
    const now = Date.now(), pending = this.pending, f = this.flushing, quiet = this.quiet(tg), maxWait = this.maxWait(tg)
    const travel = f ? flushTravel(f, now) : 0
    const placed = [...pending.map((e, i) => ({ e, pos: arrivalPos(i, e.at, now) })), ...(f ? f.events.map((e, i) => ({ e, pos: arrivalPos(i, e.at, now) - travel })) : [])]
    const items = placed.filter(p => p.pos <= G.maxPos && p.pos > G.hidePos).map(p => ({ ...slotXY(p.pos), v: p.e.value }))
    const overflow = placed.filter(p => p.pos > G.maxPos).length
    const live = bucketView(placed.filter(p => p.pos <= G.hidePos).map(p => p.e))
    const ease = 1 - Math.pow(1 - clamp01((now - this.lastCommitAt) / G.slideMs), 3)
    const doorDeg = f ? Math.round(80 * Math.min(clamp01((now - f.at) / 140), clamp01((f.doneAt - now - 60) / 160))) : 0
    const n = pending.length, first = pending[0]?.at ?? 0, last = pending.at(-1)?.at ?? 0
    const dropIn = n ? Math.max(0, Math.round(dueAt(pending, quiet, maxWait) - now)) : 0
    const status = n ? 'collecting ' + n + (f ? ' · hatch busy' : ' · drops in ' + dropIn + ' ms (' + reasonFor(pending, quiet, maxWait) + ')')
      : f ? 'hatch open · dropping ' + f.events.length : 'idle · waiting for events'
    const total = this.committed + (f?.events.length ?? 0) + n, batches = this.batchSeq + (f ? 1 : 0)
    const k = Math.max(0.1, Math.min(this.fit.w / BOX.w, this.fit.h / BOX.h))
    const dx = (this.fit.w - BOX.w * k) / 2 - BOX.x * k, dy = Math.max(0, (this.fit.h - BOX.h * k) / 2)
    const muted = 'var(--nano-muted, #9AA4B2)', fg = 'var(--nano-fg, #E6EAF0)', warn = 'var(--nano-warn, #E8B04B)'
    return html`<div style="box-sizing:border-box; height:100%; padding:12px 16px; display:flex; flex-direction:column; gap:12px; background:var(--nano-bg, #0E1116); color:${fg}; font-family:Inter, system-ui, sans-serif; overflow:hidden">
  <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:12px 20px; flex-wrap:wrap; font-family:${MONO}; font-size:12px; color:${muted}">
    <div style="display:flex; gap:20px">
      <div style="display:flex; flex-direction:column; gap:4px"><span>in → out</span><span class="ratio" style="color:${fg}; font-size:14px">${total} → ${batches} batches</span></div>
      <div style="display:flex; flex-direction:column; gap:4px"><span>avg batch</span><span style="color:${fg}; font-size:14px">${this.batchSeq ? (this.committed / this.batchSeq).toFixed(1) + ' values' : '—'}</span></div>
    </div>
    <div style="display:flex; gap:12px 20px; flex-wrap:wrap">
      ${slider('quiet', 'Quiet period in milliseconds', 0, 5000, 50, quiet, n ? now - last : 0, 'var(--nano-accent, #8FB3FF)', v => { this.dragged = { ...this.dragged, quietMs: v }; this.requestUpdate() }, v => this.set(tg, { quietMs: v }))}
      ${slider('max wait', 'Maximum wait in milliseconds', 100, 10000, 100, maxWait ?? 1000, n ? now - first : 0, warn, v => { this.dragged = { ...this.dragged, maxWaitMs: v }; this.requestUpdate() }, v => this.set(tg, { maxWaitMs: v }),
        { on: maxWait !== undefined, toggle: on => this.set(tg, { maxWaitMs: on ? 1000 : undefined }) })}
    </div>
  </div>
  <div class="fit" style="flex:1; min-height:0; position:relative; overflow:hidden"><div style="position:absolute; left:0; top:0; width:1200px; height:610px; transform:translate(${dx}px, ${dy}px) scale(${k}); transform-origin:0 0">
    ${track()}
    ${overflow ? html`<div style="position:absolute; left:100px; top:70px; font-family:${MONO}; font-size:12px; color:${warn}">+${overflow} queued</div>` : ''}
    <div class="status" style="position:absolute; left:660px; top:214px; width:400px; text-align:right; font-family:${MONO}; font-size:13px; color:${muted}">${status}</div>
    <div style="position:absolute; left:1146px; top:210px; font-family:${MONO}; font-size:11px; letter-spacing:0.08em; color:${muted}">HATCH</div>
    <div style="position:absolute; left:1082px; top:206px; width:28px; height:6px; border-radius:2px; background:${warn}; transform-origin:0 50%; transform:rotate(${doorDeg}deg); z-index:2"></div>
    <div style="position:absolute; left:1110px; top:206px; width:28px; height:6px; border-radius:2px; background:${warn}; transform-origin:100% 50%; transform:rotate(${-doorDeg}deg); z-index:2"></div>
    ${items.map(it => html`<div class="item" style="position:absolute; left:${Math.round(it.x - 20)}px; top:${Math.round(it.y - 20)}px; width:40px; height:40px; box-sizing:border-box; border-radius:10px; border:1.5px solid ${colorOf(it.v)}; background:${tint(colorOf(it.v), 0.16)}; color:${colorOf(it.v)}; display:flex; align-items:center; justify-content:center; z-index:3; font-family:${MONO}; font-size:11px; overflow:hidden">${label(it.v, 4)}</div>`)}
    <div style="position:absolute; left:0; top:0; width:1200px; height:610px; transform:translateX(${Math.round(G.pitch * (1 - ease))}px); pointer-events:none">
      ${this.batches.slice().reverse().map((b, i) => bucket(bucketView(b.events), G.xEnd - G.pitch * (i + 1) - G.pitch / 2, i + 1 >= G.history ? Math.round((1 - ease) * 100) / 100 : 1, '#' + b.id, b.reason, REASON_COLOR[b.reason], false))}
    </div>
    ${bucket(live, 1049, 1, '#' + (this.batchSeq + 1), f ? 'filling · ' + f.reason : 'next batch', muted, true, f ? warn : 'var(--nano-border-strong, #3A4350)')}
  </div></div>
</div>`
  }
}
