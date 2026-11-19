/**
 * `<nano-time-machine>`: the bar over a time machine — play/pause, step back and forward, a slider over the recording's
 * span, speed, Live and Reset. It says "history too long to rebuild state" once `store` (the recording) no longer
 * holds its clean start, and why `driver` drives no clock. Reset is a `reset` event: the host resets. It sends no message.
 *
 *   bar.tm = tm; bar.store = store; bar.driver = clockDriver(app, registry, tm)
 *   bar.addEventListener('reset', () => host.reset())
 */
import { LitElement, css, html } from 'lit'
import type { MessageStore } from './entry.ts'
import { cleanStart } from './replay.ts'
import { SPEEDS, type TimeMachine } from './time-machine.ts'

const label = (s: number) => (s < 1 ? `1/${Math.round(1 / s)}` : String(s)) + '×'

export class NanoTimeMachine extends LitElement {
  static properties = { tm: { attribute: false }, store: { attribute: false }, driver: { attribute: false }, tooLong: { state: true } }
  static styles = css`
    :host { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 8px; color: #E6EDF3; font: 12px system-ui, sans-serif; background: #0B0E12 }
    button, select { padding: 4px 10px; border: 1px solid #2A323D; border-radius: 999px; background: #12161C; color: inherit; font: inherit; cursor: pointer }
    button[aria-pressed="true"] { border-color: #4CC2FF; color: #4CC2FF }
    input[type=range] { flex: 1 1 160px; min-width: 0; accent-color: #4CC2FF }
    small { color: #94a3b8 } small.warn { color: #fbbf24 }`
  declare tm?: TimeMachine
  declare store?: MessageStore
  declare driver?: { readonly driving: string | null; readonly reason?: string }
  declare tooLong: boolean
  private off?: () => void
  private clean?: number   // the oldest seq last found to be a clean start

  constructor() { super(); this.tooLong = false }
  connectedCallback() { super.connectedCallback(); this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.off?.(); this.off = undefined }
  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('tm') || changed.has('store')) { this.tooLong = false; this.clean = undefined; this.watch() }
  }

  private watch() {
    this.off?.()
    this.off = this.isConnected ? this.tm?.subscribe(() => { this.requestUpdate(); void this.check() }) : undefined
    void this.check()
  }
  /** Once too long, it stays so until a new store or time machine: entries drop only from the oldest end. */
  private async check() {
    const store = this.store
    if (!store || this.tooLong) return
    const oldest = await store.oldest()
    if (oldest === this.clean) return
    const start = await cleanStart(store)
    if (store !== this.store) return
    this.clean = start?.seq
    this.tooLong = !start
  }
  private act(fn: (tm: TimeMachine) => void) { return () => { if (this.tm) { fn(this.tm); this.requestUpdate() } } }

  render() {
    const tm = this.tm
    if (!tm) return html``
    const playing = tm.mode === 'playing', span = tm.span, reason = this.driver?.reason
    return html`
      <button aria-label=${playing ? 'Pause' : 'Play'} @click=${this.act(t => (playing ? t.pause() : t.play()))}>${playing ? '❚❚' : '▶'}</button>
      <button aria-label="Step back" @click=${this.act(t => t.step(-1))}>◀|</button>
      <button aria-label="Step forward" @click=${this.act(t => t.step(1))}>|▶</button>
      <input type="range" aria-label="Time" min=${span.from} max=${span.to} step="1" .value=${String(Math.min(tm.cursor, span.to))}
        @input=${(e: Event) => this.act(t => t.seek(Number((e.target as HTMLInputElement).value)))()}>
      <select aria-label="Speed" @change=${(e: Event) => this.act(t => t.setSpeed(Number((e.target as HTMLSelectElement).value)))()}>
        ${SPEEDS.map(s => html`<option value=${String(s)} ?selected=${s === tm.speed}>${label(s)}</option>`)}</select>
      <button aria-label="Live" aria-pressed=${tm.mode === 'live'} @click=${this.act(t => t.live())}>Live</button>
      <button aria-label="Reset" @click=${() => this.dispatchEvent(new CustomEvent('reset', { bubbles: true, composed: true }))}>Reset</button>
      ${this.tooLong ? html`<small class="warn">history too long to rebuild state</small>` : ''}
      ${reason ? html`<small>${reason}</small>` : ''}`
  }
}
