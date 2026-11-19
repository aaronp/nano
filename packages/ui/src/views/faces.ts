/**
 * The nano.ui pods' simple views: `nano-map` (its code and last output) and `nano-log` (its entries). `nano-input` and
 * `nano-debounce` have files of their own.
 */
import { html } from 'lit'
import { port, type AppEvent, type NanoResult } from '@pritzlaff/nano-core'
import { Log, MapIface } from '../interfaces.ts'
import { shown, ViewElement, type ViewTarget } from './view.ts'

const MAP = port(MapIface, MapIface.ops.map)

export class NanoMap extends ViewElement {
  private mine = new Set<string>()
  private output?: NanoResult<unknown>

  protected hear(e: AppEvent, tg: ViewTarget) {
    if (e.type === 'sent' && e.to === tg.pod && e.port === MAP) this.mine.add(e.id)
    else if (e.type === 'denied') this.mine.delete(e.id)
    else if (e.type === 'delivered' && this.mine.delete(e.id)) { this.output = e.result; this.requestUpdate() }
  }
  protected face(tg: ViewTarget) {
    const code = (tg.app.deployment().pods[tg.pod]?.config as { code?: string } | undefined)?.code ?? ''
    return html`<pre class="code">${code}</pre><div>out ${shown(this.output)}</div>`
  }
}

const LOG = port(Log, Log.ops.log)

export class NanoLog extends ViewElement {
  private entries: unknown[] = []
  private logs = new Set<string>()

  protected started(tg: ViewTarget) { void this.read(tg) }
  private async read(tg: ViewTarget) {
    const r = await this.pod(tg).entries(null)
    if (r.ok) { this.entries = r.value as unknown[]; this.requestUpdate() }
  }
  protected hear(e: AppEvent, tg: ViewTarget) {
    if (e.type === 'sent' && e.to === tg.pod && e.port === LOG) this.logs.add(e.id)
    else if (e.type === 'denied') this.logs.delete(e.id)
    else if (e.type === 'delivered' && this.logs.delete(e.id)) void this.read(tg)
  }
  protected face() {
    return html`<ol>${this.entries.map(x => html`<li>${typeof x === 'string' ? x : JSON.stringify(x)}</li>`)}</ol>`
  }
}
