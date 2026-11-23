import { html } from 'lit'
import type { Static } from 'typebox'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { Calculator, History, type Calculated } from './interfaces.ts'
import { View } from './view.ts'

type Entry = Static<typeof Calculated>
const OPS = ['+', '-', '*', '/'] as const

/** `<nano-calculator>`: two numbers, an operator and `=`, the result, and the history (read again on each `calculated`). */
export class CalculatorView extends View {
  static properties = { ...View.properties, a: { state: true }, op: { state: true }, b: { state: true }, result: { state: true }, error: { state: true }, saved: { state: true } }
  declare a: string
  declare op: Entry['op']
  declare b: string
  declare result?: number
  declare error?: string
  declare saved: Entry[]
  constructor() { super(); this.a = this.b = ''; this.op = '+'; this.saved = [] }

  private iter?: AsyncIterator<unknown>
  disconnectedCallback() { super.disconnectedCallback(); this.end() }
  private end() { void this.iter?.return?.(); this.iter = undefined }

  // #region calculator-listen
  protected async started(t: ViewTarget) {
    this.end()
    void this.load(t)
    const it = this.iter = t.app.runtime(t.runtime).get(Calculator, { pod: t.pod }).calculated()[Symbol.asyncIterator]()
    try { while (!(await it.next()).done && this.iter === it) await this.load(t) } catch { /* the pod is gone */ }
  }
  // #endregion calculator-listen
  /** The history pod in this runtime, if there is one. */
  private async load(t: ViewTarget) {
    try { this.saved = await t.app.runtime(t.runtime).get(History).load() } catch { this.saved = [] }
  }
  private async equals(t: ViewTarget) {
    const r = await this.pod(t).calculate({ a: Number(this.a), op: this.op, b: Number(this.b) })
    if (r.ok) { this.result = (r.value as Entry).result; this.error = undefined }
    else { this.result = undefined; this.error = r.fail.reason }
  }
  // #region calculator-view
  protected face(t: ViewTarget) {
    const enter = (e: KeyboardEvent) => { if (e.key === 'Enter') void this.equals(t) }
    return html`<div class="row">
        <input class="input" type="number" aria-label="a" .value=${this.a} @input=${(e: Event) => { this.a = (e.target as HTMLInputElement).value }} @keydown=${enter}>
        <select class="input" aria-label="operator" .value=${this.op} @change=${(e: Event) => { this.op = (e.target as HTMLSelectElement).value as Entry['op'] }}>
          ${OPS.map(o => html`<option value=${o} ?selected=${o === this.op}>${o}</option>`)}</select>
        <input class="input" type="number" aria-label="b" .value=${this.b} @input=${(e: Event) => { this.b = (e.target as HTMLInputElement).value }} @keydown=${enter}>
        <button class="btn" aria-label="equals" @click=${() => this.equals(t)}>=</button>
        <output class="badge accent" aria-label="result">${this.result ?? ''}</output></div>
      ${this.error ? html`<p class="alert bad" role="alert">${this.error}</p>` : ''}
      <ol aria-label="history">${this.saved.map(s => html`<li>${s.a} ${s.op} ${s.b} = ${s.result}</li>`)}</ol>`
  }
  // #endregion calculator-view
}
