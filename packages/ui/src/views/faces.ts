/**
 * The nano.ui pods' own views: `nano-input` (a field; Enter submits), `nano-debounce` (pending, a flash on flushed),
 * `nano-map` (its code, the last input and output) and `nano-log` (its entries).
 */
import { css, html } from 'lit'
import { port, type AppEvent, type NanoResult } from '@pritzlaff/nano'
import { base, t } from '@pritzlaff/nano-elements'
import { Debounce, Log, MapIface } from '../interfaces.ts'
import { shown, ViewElement, type ViewTarget } from './view.ts'

export class NanoInput extends ViewElement {
  private async enter(e: KeyboardEvent, tg: ViewTarget) {
    if (e.key !== 'Enter') return
    const box = e.target as HTMLInputElement
    await this.pod(tg).submit(box.value)
  }
  protected face(tg: ViewTarget) {
    return html`<input type="text" aria-label=${tg.pod} @keydown=${(e: KeyboardEvent) => this.enter(e, tg)}>`
  }
}

const PUSH = port(Debounce, Debounce.ops.push)

export class NanoDebounce extends ViewElement {
  static styles = [base, css`.flash { color: ${t('accent')} }`]
  private pending = false
  private flash = false
  private timer?: ReturnType<typeof setTimeout>

  protected hear(e: AppEvent, tg: ViewTarget) {
    if (e.type !== 'sent') return
    if (e.to === tg.pod && e.port === PUSH) this.pending = true
    else if (e.from === tg.pod) {
      this.pending = false
      this.flash = true
      clearTimeout(this.timer)
      this.timer = setTimeout(() => { this.flash = false; this.requestUpdate() }, 300)
    } else return
    this.requestUpdate()
  }
  disconnectedCallback() { super.disconnectedCallback(); clearTimeout(this.timer) }
  protected face() {
    return html`<span class=${this.flash ? 'badge accent flash' : 'badge'}>${this.flash ? 'flushed' : this.pending ? 'pending' : 'idle'}</span>`
  }
}

const MAP = port(MapIface, MapIface.ops.map)

export class NanoMap extends ViewElement {
  // ponytail: an input is known only when it is an earlier delivered result (its `cause`); a published event's data is not on the stream.
  private results = new Map<string, NanoResult<unknown>>()
  private mine = new Set<string>()
  private input?: NanoResult<unknown>
  private output?: NanoResult<unknown>

  protected hear(e: AppEvent, tg: ViewTarget) {
    if (e.type === 'delivered') {
      if (this.results.size > 200) this.results.clear()
      this.results.set(e.id, e.result)
      if (!this.mine.delete(e.id)) return
      this.output = e.result
    } else if (e.type === 'sent' && e.to === tg.pod && e.port === MAP) {
      this.mine.add(e.id)
      this.input = e.cause === undefined ? undefined : this.results.get(e.cause)
    } else return
    this.requestUpdate()
  }
  protected face(tg: ViewTarget) {
    const code = (tg.app.deployment().pods[tg.pod]?.config as { code?: string } | undefined)?.code ?? ''
    return html`<pre class="code">${code}</pre><div>in ${shown(this.input)}</div><div>out ${shown(this.output)}</div>`
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
    else if (e.type === 'delivered' && this.logs.delete(e.id)) void this.read(tg)
  }
  protected face() {
    return html`<ol>${this.entries.map(x => html`<li>${typeof x === 'string' ? x : JSON.stringify(x)}</li>`)}</ol>`
  }
}
