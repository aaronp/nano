import { html } from 'lit'
import { View } from '@composable/ui'
import type { Created } from '@composable/sdk'
import { submitted, type debug, type eventsTable, type textEmit } from '.'

export class TextEmitView extends View<Created<typeof textEmit>> {
  render() {
    const c = this.component
    return html`<form @submit=${(e: Event) => { e.preventDefault(); void c.emit(submitted, c.state.value) }}>
      <input aria-label="Message" .value=${c.state.value} @input=${(e: Event) => { c.state.value = (e.target as HTMLInputElement).value }}>
      <button>Send</button>
    </form>`
  }
}

export class EventsTableView extends View<Created<typeof eventsTable>> {
  render() {
    return html`<table>
      <thead><tr><th>Time</th><th>From</th><th>Data</th></tr></thead>
      <tbody>${this.component.state.rows.map(r => html`<tr><td>${r.at}</td><td>${r.from}</td><td><code>${JSON.stringify(r.data)}</code></td></tr>`)}</tbody>
    </table>`
  }
}

export class DebugView extends View<Created<typeof debug>> {
  render() {
    const { input, table } = this.component.children
    return html`<text-emit .component=${input}></text-emit><events-table .component=${table}></events-table>`
  }
}

/** Register the views under their default tags. Call once; hosts that want other tags define the classes themselves. */
export const defineElements = () => {
  customElements.define('text-emit', TextEmitView)
  customElements.define('events-table', EventsTableView)
  customElements.define('debug-panel', DebugView)
}
