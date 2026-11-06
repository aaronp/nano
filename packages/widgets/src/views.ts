import { css, html } from 'lit'
import { View, base, t } from '@composable/ui'
import type { Created } from '@composable/sdk'
import { chart, counter, debug, eventsTable, log, mapper, slider, submitted, textEmit, valueChanged } from '.'

export class TextEmitView extends View<Created<typeof textEmit>> {
  static factory = textEmit
  static styles = [base, css`form { display: flex; gap: ${t.gap}; } input { flex: 1; min-width: 0; }`]
  render() {
    const c = this.component
    return html`<form @submit=${(e: Event) => { e.preventDefault(); void c.publish(submitted, c.state.value) }}>
      <input aria-label="Message" .value=${c.state.value} @input=${(e: Event) => { c.state.value = (e.target as HTMLInputElement).value }}>
      <button>Send</button>
    </form>`
  }
}

export class EventsTableView extends View<Created<typeof eventsTable>> {
  static factory = eventsTable
  static styles = base
  render() {
    return html`<table>
      <thead><tr><th>Time</th><th>From</th><th>Data</th></tr></thead>
      <tbody>${this.component.state.rows.map(r => html`<tr><td>${r.at}</td><td>${r.from}</td><td><code>${JSON.stringify(r.data)}</code></td></tr>`)}</tbody>
    </table>`
  }
}

/** Renders its children's views from their classes, so it works whatever tags the host registered them under. */
export class DebugView extends View<Created<typeof debug>> {
  static factory = debug
  static styles = [base, css`:host { display: grid; gap: ${t.gap}; }`]
  #input = new TextEmitView()
  #table = new EventsTableView()
  render() {
    const { input, table } = this.component.children
    this.#input.component = input; this.#table.component = table
    return html`${this.#input}${this.#table}`
  }
}

export class SliderView extends View<Created<typeof slider>> {
  static factory = slider
  static styles = [base, css`label { display: grid; gap: 4px; } output { color: ${t.accent}; font-weight: 600; } input { accent-color: ${t.accent}; padding: 0; }`]
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
  static factory = mapper({ label: 'x × 2', fn: x => x * 2 })
  static styles = [base, css`code { color: ${t.muted}; } .big { font-size: 1.6em; margin: 4px 0 0; }`]
  render() {
    const s = this.component.state
    return html`<code>${s.label}</code><p class="big">${show(s.input)} → ${show(s.output)}</p>`
  }
}

export class CounterView extends View<Created<ReturnType<typeof counter>>> {
  static factory = counter({ every: 5 })
  static styles = [base, css`.big { font-size: 1.6em; margin: 0; } small { color: ${t.muted}; }`]
  render() {
    const s = this.component.state
    return html`<p class="big">${s.n}</p><small>publishes <code>reached</code> every ${s.every}</small>`
  }
}

export class ChartView extends View<Created<typeof chart>> {
  static factory = chart
  static styles = [base, css`svg { color: ${t.accent}; display: block; } small { color: ${t.muted}; }`]
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
  static factory = log
  static styles = base
  render() {
    return html`<table>
      <thead><tr><th>Time</th><th>From</th><th>Op</th><th>Payload</th><th>Correlation</th></tr></thead>
      <tbody>${this.component.state.rows.map(r => html`<tr>
        <td>${r.at}</td><td>${r.from}</td><td><code>${r.op}</code></td><td><code>${JSON.stringify(r.payload)}</code></td><td><code>${r.correlation}</code></td>
      </tr>`)}</tbody>
    </table>`
  }
}

export const views = {
  'text-emit': TextEmitView, 'events-table': EventsTableView, 'debug-panel': DebugView,
  'flow-slider': SliderView, 'flow-mapper': MapperView, 'flow-counter': CounterView, 'flow-chart': ChartView, 'flow-log': LogView,
}

/**
 * Each view knows its factory, so written in markup inside a scope provider (`provideScope`) it places itself;
 * MapperView and CounterView default to doubling and every 5. Register the views as `${prefix}<name>` (e.g. 'acme-text-emit'). Already-registered tags are left alone, so
 * calling twice is safe; a second copy of this package can live alongside under its own prefix.
 */
export const defineElements = (prefix = '') => {
  for (const [name, view] of Object.entries(views)) if (!customElements.get(prefix + name)) customElements.define(prefix + name, view)
}
