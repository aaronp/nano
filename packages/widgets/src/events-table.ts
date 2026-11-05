import Type from 'typebox'
import { html } from 'lit'
import { Actions, Components, defineManifest } from '@composable/sdk'
import { View, Widgets } from '@composable/sdk/lit'

export const onEvent = Actions.declare('composable', 'on-event', Type.Unknown())
const manifest = defineManifest({ id: { author: 'composable', id: 'events-table' }, version: '0.1.0', emits: [], consumes: [onEvent] })

const logic = () => {
  const rows: { at: string; from: string; data: unknown }[] = []
  return Object.assign(Components.create(manifest, {
    actions: [[onEvent, (_c, data, inv) => { rows.push({ at: new Date().toLocaleTimeString(), from: inv.from.instance, data }) }]],
  }), { rows })
}

customElements.define('events-table', class extends View<ReturnType<typeof logic>> {
  render() {
    return html`<table>
      <thead><tr><th>Time</th><th>From</th><th>Data</th></tr></thead>
      <tbody>${this.model.rows.map(r => html`<tr><td>${r.at}</td><td>${r.from}</td><td><code>${JSON.stringify(r.data)}</code></td></tr>`)}</tbody>
    </table>`
  }
})

export const eventsTable = Widgets.view(manifest, 'events-table', logic)
