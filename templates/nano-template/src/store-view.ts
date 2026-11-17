import { html } from 'lit'
import { port, type AppEvent } from '@pritzlaff/nano-core'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { Store } from './interfaces.ts'
import { View } from './view.ts'

const WRITES = [port(Store, Store.ops.set), port(Store, Store.ops.remove)]

/** `<nano-store>`: its entries, with a remove button each, refreshed whenever a set or remove is delivered. */
export class StoreView extends View {
  static properties = { ...View.properties, entries: { state: true } }
  declare entries: Record<string, string>
  private writes = new Set<string>()
  constructor() { super(); this.entries = {} }

  protected started(t: ViewTarget) { void this.read(t) }
  private async read(t: ViewTarget) {
    const r = await this.pod(t).entries(null)
    if (r.ok) this.entries = r.value as Record<string, string>
  }
  protected hear(e: AppEvent, t: ViewTarget) {
    if (e.type === 'sent' && e.to === t.pod && WRITES.includes(e.port)) this.writes.add(e.id)
    else if (e.type === 'denied') this.writes.delete(e.id)
    else if (e.type === 'delivered' && this.writes.delete(e.id)) void this.read(t)
  }
  protected face(t: ViewTarget) {
    return html`<table class="table"><tbody>${Object.entries(this.entries).map(([k, v]) => html`<tr><td>${k}</td><td>${v}</td>
      <td><button class="btn small" aria-label="Remove ${k}" @click=${() => this.pod(t).remove(k)}>×</button></td></tr>`)}</tbody></table>`
  }
}
