import { html } from 'lit'
import type { AppEvent } from '@pritzlaff/nano-core'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { View } from './view.ts'

/** `<nano-timer>`: start and stop, and the ticks heard since it opened (each tick is a pipe message from this pod). */
// `count` and `running` are this view's own: it counts the ticks it has seen, and reflects the Start and Stop it sent.
export class TimerView extends View {
  static properties = { ...View.properties, count: { state: true }, running: { state: true } }
  declare count: number
  declare running: boolean
  constructor() { super(); this.count = 0; this.running = false }

  protected hear(e: AppEvent, t: ViewTarget) { if (e.type === 'sent' && e.kind === 'pipe' && e.from === t.pod) this.count += 1 }
  private async run(t: ViewTarget, on: boolean) {
    const r = await (on ? this.pod(t).start(null) : this.pod(t).stop(null))
    if (r.ok) this.running = on
  }
  protected face(t: ViewTarget) {
    return html`<span class="badge accent" aria-label="ticks seen">${this.count}</span>
      <button class="btn" ?disabled=${this.running} @click=${() => this.run(t, true)}>Start</button>
      <button class="btn" ?disabled=${!this.running} @click=${() => this.run(t, false)}>Stop</button>`
  }
}
