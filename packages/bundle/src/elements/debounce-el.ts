// <c-debounce>: the debounce prototype's view over the real component. Queued values wait in the switchback; when the
// component flushes, the batch drops through the hatch into a bucket, and the buckets slide along as history.
import { css, html } from 'lit'
import { PlacedElement } from '@composable/elements'
import { Debounce, type Queued } from '../components/debounce'
import { arrivalPos, bucketView, clamp01, colorOf, flushTravel, G, label, reasonFor, rgba, slotXY, startFlush, type Batch, type Flushing } from './debounce-model'

const MONO = "'JetBrains Mono', ui-monospace, monospace"
/** The part of the prototype's 1200×610 stage that has anything on it; it is scaled to fit the panel. */
const BOX = { x: 90, w: 1090, h: 600 }
const REASON_COLOR = { quiet: '#9AA4B2', 'max wait': '#E8B04B' }

/** The debounce prototype's view of one debouncer: its queue, hatch, batches, and quiet and max-wait settings. */
export class DebounceEl extends PlacedElement {
  static component = Debounce
  static styles = css`:host { display: block; height: 100%; min-height: 160px }`
  /** The last batch seen dropping, and the queue it came from (until the component publishes its emptied queue). */
  #batch: unknown
  #flushedQ: unknown
  #seen: Queued[] = []
  flushing: Flushing | null = null
  batches: Batch[] = []
  batchSeq = 0
  committed = 0
  lastCommitAt = -1e9
  #raf = 0
  /** The stage area's size, measured; the stage scales to fit it. */
  #fit = { w: BOX.w, h: BOX.h }
  #ro?: ResizeObserver

  firstUpdated() {
    const box = this.renderRoot.querySelector<HTMLElement>('.fit')
    if (!box || typeof ResizeObserver === 'undefined') return
    this.#ro = new ResizeObserver(() => { this.#fit = { w: box.clientWidth, h: box.clientHeight }; this.requestUpdate() })
    this.#ro.observe(box)
  }
  connectedCallback() { super.connectedCallback(); const box = this.renderRoot?.querySelector?.('.fit'); if (box) this.#ro?.observe(box) }
  disconnectedCallback() { super.disconnectedCallback(); this.#ro?.disconnect(); cancelAnimationFrame(this.#raf); this.#raf = 0 }

  get quiet() { return this.read<number>(Debounce.ops.quiet) ?? 300 }
  get maxWait() { return this.read<number>(Debounce.ops.maxWait) ?? 1000 }
  /** What is waiting: the published queue, unless that is the queue that just flushed. */
  get pending(): Queued[] { const q = this.read<Queued[]>(Debounce.ops.queued) ?? []; return q === this.#flushedQ ? [] : q }

  /** A new `flushed` starts a drop; a new queue is remembered, so the drop knows when its values arrived. */
  willUpdate(changed: Map<string, unknown>) {
    super.willUpdate(changed)
    const now = Date.now(), b = this.read<unknown[]>(Debounce.ops.flushed)
    if (b && b !== this.#batch) {
      this.#batch = b; this.#flushedQ = this.read(Debounce.ops.queued)
      const seen = this.#seen.length === b.length ? this.#seen : b.map(value => ({ value, at: now }))
      if (this.flushing) this.#commit(now)
      this.flushing = startFlush(seen, now, reasonFor(seen, this.quiet, this.maxWait))
      this.#seen = []
    }
    if (this.pending.length) this.#seen = this.pending
    this.#tick(now)
  }
  updated() { if (this.#active(Date.now()) && !this.#raf) this.#raf = requestAnimationFrame(() => { this.#raf = 0; this.requestUpdate() }) }

  #commit(now: number) {
    const f = this.flushing!
    this.batchSeq += 1; this.committed += f.events.length; this.lastCommitAt = now
    this.batches = [...this.batches, { id: this.batchSeq, events: f.events, reason: f.reason }].slice(-G.history)
    this.flushing = null
  }
  #tick(now: number) { if (this.flushing && now >= this.flushing.doneAt) this.#commit(now) }
  #active(now: number) { return this.pending.length > 0 || this.flushing !== null || now - this.lastCommitAt < G.slideMs }

  render() {
    const now = Date.now(), pending = this.pending, f = this.flushing, quiet = this.quiet, maxWait = this.maxWait
    const travel = f ? flushTravel(f, now) : 0
    const placed = [...pending.map((e, i) => ({ e, pos: arrivalPos(i, e.at, now) })), ...(f ? f.events.map((e, i) => ({ e, pos: arrivalPos(i, e.at, now) - travel })) : [])]
    const items = placed.filter(p => p.pos <= G.maxPos && p.pos > G.hidePos).map(p => ({ ...slotXY(p.pos), v: p.e.value }))
    const overflow = placed.filter(p => p.pos > G.maxPos).length
    const live = bucketView(placed.filter(p => p.pos <= G.hidePos).map(p => p.e))
    const ease = 1 - Math.pow(1 - clamp01((now - this.lastCommitAt) / G.slideMs), 3)
    const doorDeg = f ? Math.round(80 * Math.min(clamp01((now - f.at) / 140), clamp01((f.doneAt - now - 60) / 160))) : 0
    const n = pending.length, first = pending[0]?.at ?? 0, last = pending.at(-1)?.at ?? 0
    const quietElapsed = n ? now - last : 0, maxElapsed = n ? now - first : 0
    const dropIn = n ? Math.max(0, Math.round(Math.min(last + quiet, first + maxWait) - now)) : 0
    const status = n ? 'collecting ' + n + (f ? ' · hatch busy' : ' · drops in ' + dropIn + ' ms (' + reasonFor(pending, quiet, maxWait) + ')')
      : f ? 'hatch open · dropping ' + f.events.length : 'idle · waiting for events'
    const total = this.committed + (f?.events.length ?? 0) + n, batches = this.batchSeq + (f ? 1 : 0)
    const k = Math.max(0.1, Math.min(this.#fit.w / BOX.w, this.#fit.h / BOX.h))
    const dx = (this.#fit.w - BOX.w * k) / 2 - BOX.x * k, dy = Math.max(0, (this.#fit.h - BOX.h * k) / 2)
    const slider = (name: string, min: number, max: number, step: number, value: number, elapsed: number, color: string, set: typeof Debounce.ops.setQuiet) => html`
      <label style="display:flex; flex-direction:column; gap:6px; width:180px">
        <span style="display:flex; justify-content:space-between"><span>${name}</span><span style="color:#E6EAF0">${Math.round(Math.min(elapsed, value))} / ${value} ms</span></span>
        <span style="display:block; height:6px; border-radius:3px; background:#222933; overflow:hidden"><span style="display:block; height:6px; width:${Math.round(clamp01(elapsed / value) * 100)}%; background:${color}"></span></span>
        <input type="range" min=${min} max=${max} step=${step} .value=${String(value)} @input=${(e: Event) => this.act(set, Number((e.target as HTMLInputElement).value))} aria-label=${name === 'quiet' ? 'Quiet period in milliseconds' : 'Maximum wait in milliseconds'} style="width:180px; margin:0; accent-color:${color}">
      </label>`
    return html`<div style="box-sizing:border-box; height:100%; padding:12px 16px; display:flex; flex-direction:column; gap:12px; background:#0E1116; color:#E6EAF0; font-family:Inter, system-ui, sans-serif; overflow:hidden">
  <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:12px 20px; flex-wrap:wrap; font-family:${MONO}; font-size:12px; color:#9AA4B2">
    <div style="display:flex; gap:20px">
      <div style="display:flex; flex-direction:column; gap:4px"><span>in → out</span><span class="ratio" style="color:#E6EAF0; font-size:14px">${total} → ${batches} batches</span></div>
      <div style="display:flex; flex-direction:column; gap:4px"><span>avg batch</span><span style="color:#E6EAF0; font-size:14px">${this.batchSeq ? (this.committed / this.batchSeq).toFixed(1) + ' values' : '—'}</span></div>
    </div>
    <div style="display:flex; gap:12px 20px; flex-wrap:wrap">${slider('quiet', 100, 5000, 50, quiet, quietElapsed, '#8FB3FF', Debounce.ops.setQuiet)}${slider('max wait', 200, 10000, 100, maxWait, maxElapsed, '#E8B04B', Debounce.ops.setMaxWait)}</div>
  </div>
  ${this.problem ? html`<div style="color:#FFB4A8; font-size:13px">${this.problem}</div>` : ''}
  <div class="fit" style="flex:1; min-height:0; position:relative; overflow:hidden"><div style="position:absolute; left:0; top:0; width:1200px; height:610px; transform:translate(${dx}px, ${dy}px) scale(${k}); transform-origin:0 0">
    ${track()}
    ${overflow ? html`<div style="position:absolute; left:100px; top:70px; font-family:${MONO}; font-size:12px; color:#E8B04B">+${overflow} queued</div>` : ''}
    <div class="status" style="position:absolute; left:660px; top:214px; width:400px; text-align:right; font-family:${MONO}; font-size:13px; color:#9AA4B2">${status}</div>
    <div style="position:absolute; left:1146px; top:210px; font-family:${MONO}; font-size:11px; letter-spacing:0.08em; color:#9AA4B2">HATCH</div>
    <div style="position:absolute; left:1082px; top:206px; width:28px; height:6px; border-radius:2px; background:#E8B04B; transform-origin:0 50%; transform:rotate(${doorDeg}deg); z-index:2"></div>
    <div style="position:absolute; left:1110px; top:206px; width:28px; height:6px; border-radius:2px; background:#E8B04B; transform-origin:100% 50%; transform:rotate(${-doorDeg}deg); z-index:2"></div>
    ${items.map(it => html`<div class="item" style="position:absolute; left:${Math.round(it.x - 20)}px; top:${Math.round(it.y - 20)}px; width:40px; height:40px; box-sizing:border-box; border-radius:10px; border:1.5px solid ${colorOf(it.v)}; background:${rgba(colorOf(it.v), 0.16)}; color:${colorOf(it.v)}; display:flex; align-items:center; justify-content:center; z-index:3; font-family:${MONO}; font-size:11px; overflow:hidden">${label(it.v, 4)}</div>`)}
    <div style="position:absolute; left:0; top:0; width:1200px; height:610px; transform:translateX(${Math.round(G.pitch * (1 - ease))}px); pointer-events:none">
      ${this.batches.slice().reverse().map((b, i) => bucket(bucketView(b.events), G.xEnd - G.pitch * (i + 1) - G.pitch / 2, i + 1 >= G.history ? Math.round((1 - ease) * 100) / 100 : 1, '#' + b.id, b.reason, REASON_COLOR[b.reason], false))}
    </div>
    ${bucket(live, 1049, 1, '#' + (this.batchSeq + 1), f ? 'filling · ' + f.reason : 'next batch', '#9AA4B2', true, f ? '#E8B04B' : '#3A4350')}
  </div></div>
</div>`
  }
}

/** The switchback track the queue runs along, from the entry at the top-left down to the hatch. */
const track = () => html`
  <div style="position:absolute; left:100px; top:12px; width:80px; height:48px; border-radius:24px 0 0 24px; background:#131820"></div>
  <div style="position:absolute; left:114px; top:28px; font-family:${MONO}; font-size:12px; color:#9AA4B2">in →</div>
  <div style="position:absolute; left:164px; top:12px; width:974px; height:48px; border-radius:24px; background:#161B22"></div>
  <div style="position:absolute; left:1086px; top:36px; width:48px; height:70px; background:#161B22"></div>
  <div style="position:absolute; left:164px; top:82px; width:974px; height:48px; border-radius:24px; background:#161B22"></div>
  <div style="position:absolute; left:168px; top:106px; width:48px; height:70px; background:#161B22"></div>
  <div style="position:absolute; left:164px; top:152px; width:974px; height:48px; border-radius:24px; background:#161B22"></div>
  <div style="position:absolute; left:1082px; top:176px; width:56px; height:114px; background:#161B22"></div>`

/** A batch bucket: its count, its cells stacked from the bottom, and its id and reason underneath. The live one is
 * the bucket under the hatch. */
function bucket(v: ReturnType<typeof bucketView>, left: number, opacity: number, id: string, reason: string, reasonColor: string, live: boolean, border = '#2A313C') {
  return html`<div class=${live ? 'live' : 'batch'} style="position:absolute; left:${left}px; top:0; width:122px; height:610px; opacity:${opacity}; pointer-events:none">
    ${v.n ? html`<div style="position:absolute; left:0; top:${v.countTop}px; width:122px; text-align:center; font-family:${MONO}; font-size:13px; color:#E6EAF0">${v.n}</div>` : ''}
    <div style="position:absolute; left:15px; top:290px; width:92px; height:270px; box-sizing:border-box; border:${live ? '2px solid ' + border : '1px ' + (v.solid ? 'solid' : 'dashed') + ' #2A313C'}; border-top:none; border-radius:0 0 10px 10px; padding:${live ? 3 : 4}px; display:flex; flex-direction:column-reverse; gap:${v.gap}px; overflow:hidden${live ? '; background:#12171E' : ''}">
      ${v.cells.map(c => html`<div class="cell" style="flex:none; height:${c.h}px; box-sizing:border-box; border-radius:3px; background:${c.bg}; border:1px solid ${c.color}; color:${c.color}; display:flex; align-items:center; justify-content:center; font-family:${MONO}; font-size:10px; overflow:hidden">${c.text}</div>`)}
    </div>
    <div style="position:absolute; left:0; top:568px; width:122px; display:flex; flex-direction:column; align-items:center; gap:3px; font-family:${MONO}; font-size:12px">
      <span style="color:${live ? '#E8B04B' : '#E6EAF0'}">${id}</span><span style="color:${reasonColor}">${reason}</span>
    </div>
  </div>`
}
