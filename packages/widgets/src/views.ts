import { html } from 'lit'
import { View } from '@composable/ui'
import type { Created } from '@composable/sdk'
import { submitted, valueChanged, type chart, type counter, type debug, type eventsTable, type log, type mapper, type slider, type textEmit } from '.'

export class TextEmitView extends View<Created<typeof textEmit>> {
  render() {
    const c = this.component
    return html`<form @submit=${(e: Event) => { e.preventDefault(); void c.publish(submitted, c.state.value) }}>
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

export class SliderView extends View<Created<typeof slider>> {
  render() {
    const c = this.component
    return html`<label>Value <output>${c.state.value}</output>
      <input type="range" min="0" max="100" .value=${String(c.state.value)}
        @input=${(e: Event) => { c.state.value = Number((e.target as HTMLInputElement).value); void c.publish(valueChanged, c.state.value) }}>
    </label>`
  }
}

const show = (n?: number) => n === undefined ? '–' : String(Math.round(n * 100) / 100)
export class MapperView extends View<Created<ReturnType<typeof mapper>>> {
  render() {
    const s = this.component.state
    return html`<code>${s.label}</code><p class="big">${show(s.input)} → ${show(s.output)}</p>`
  }
}

export class CounterView extends View<Created<ReturnType<typeof counter>>> {
  render() {
    const s = this.component.state
    return html`<p class="big">${s.n}</p><small>publishes <code>reached</code> every ${s.every}</small>`
  }
}

export class ChartView extends View<Created<typeof chart>> {
  render() {
    const p = this.component.state.points, w = 300, h = 100
    const max = Math.max(1, ...p), step = w / Math.max(1, p.length - 1)
    const pts = p.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ')
    return html`<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Line chart of recent values">
      <polyline points=${pts} fill="none" stroke="currentColor" stroke-width="2"></polyline>
    </svg><small>${p.length} points, max ${show(max)}</small>`
  }
}

export class LogView extends View<Created<typeof log>> {
  render() {
    return html`<table>
      <thead><tr><th>Time</th><th>From</th><th>Op</th><th>Payload</th><th>Origin</th><th>Depth</th></tr></thead>
      <tbody>${this.component.state.rows.map(r => html`<tr>
        <td>${r.at}</td><td>${r.from}</td><td><code>${r.op}</code></td><td><code>${JSON.stringify(r.payload)}</code></td><td>${r.origin}</td><td>${r.depth}</td>
      </tr>`)}</tbody>
    </table>`
  }
}

/** Register the views under their default tags. Call once; hosts that want other tags define the classes themselves. */
export const defineElements = () => {
  customElements.define('text-emit', TextEmitView)
  customElements.define('events-table', EventsTableView)
  customElements.define('debug-panel', DebugView)
  customElements.define('flow-slider', SliderView)
  customElements.define('flow-mapper', MapperView)
  customElements.define('flow-counter', CounterView)
  customElements.define('flow-chart', ChartView)
  customElements.define('flow-log', LogView)
}
