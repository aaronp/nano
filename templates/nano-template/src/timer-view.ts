import { html } from 'lit'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { View } from './view.ts'
import { Timer } from './interfaces.ts'

/** `<nano-timer>`: start and stop, and the ticks heard since it opened (it subscribes to its pod's `tick` itself while connected). */
// `count` and `running` are this view's own: it counts the ticks it has seen, and reflects the Start and Stop it sent.
export class TimerView extends View {
  static properties = { ...View.properties, count: { state: true }, running: { state: true } }
  declare count: number
  declare running: boolean
  constructor() { super(); this.count = 0; this.running = false }

  private iter?: AsyncIterator<unknown>

  disconnectedCallback() { super.disconnectedCallback(); this.end() }
  private end() { void this.iter?.return?.(); this.iter = undefined }
  protected async started(t: ViewTarget) {
    this.end()
    const it = this.iter = t.app.runtime(t.runtime).get(Timer, { pod: t.pod }).tick()[Symbol.asyncIterator]()
    try { while (!(await it.next()).done && this.iter === it) this.count += 1 } catch { /* the pod is gone: the count stays */ }
  }
  private async run(t: ViewTarget, on: boolean) {
    const r = await (on ? this.pod(t).start(null) : this.pod(t).stop(null))
    if (r.ok) this.running = on
  }
  // #region timer-view
  protected face(t: ViewTarget) {
    return html`<div class="row"><span class="badge accent" aria-label="ticks seen">${this.count}</span>
      <button class="btn" ?disabled=${this.running} @click=${() => this.run(t, true)}>Start</button>
      <button class="btn" ?disabled=${!this.running} @click=${() => this.run(t, false)}>Stop</button></div>`
  }
  // #endregion timer-view
}
