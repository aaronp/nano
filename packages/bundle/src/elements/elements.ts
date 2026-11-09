// The bundle's elements: each places its component by `name` and is a thin view onto it.
import { css, html } from 'lit'
import type { Op } from '@pritzlaff/nano-core'
import { base, PlacedElement } from '@pritzlaff/nano-elements'
import { Filter, Map } from '../components/code'
import { DebounceEl } from './debounce-el'
import { Input, type Kind } from '../components/input'
import { Log, type Entry } from '../components/log'
import { Range } from '../components/range'

const KINDS: Kind[] = ['text', 'textarea', 'number', 'boolean']
const target = (e: Event) => e.target as HTMLInputElement
const problem = (p?: string) => (p ? html`<div class="problem">${p}</div>` : '')

/** An input and a Send button; Enter (Ctrl/Cmd+Enter in a text area) or ticking a checkbox submits. */
export class InputEl extends PlacedElement {
  static component = Input
  static styles = base
  render() {
    const kind = this.read<Kind>(Input.ops.kind) ?? 'text', value = this.read<unknown>(Input.ops.value)
    const parse = (el: HTMLInputElement) => (kind === 'number' ? Number(el.value) : kind === 'boolean' ? el.checked : el.value)
    const set = (e: Event) => this.act(Input.ops.setValue, parse(target(e)))
    const send = async (e: Event) => { await set(e); await this.act(Input.ops.submit) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter' && (kind !== 'textarea' || e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(e) } }
    const field = kind === 'textarea' ? html`<textarea rows="3" .value=${String(value ?? '')} @input=${set} @keydown=${key}></textarea>`
      : kind === 'boolean' ? html`<input type="checkbox" .checked=${!!value} @change=${send}>`
      : html`<input type=${kind} .value=${String(value ?? '')} @input=${set} @keydown=${key}>`
    return html`<div class="row">
      <select aria-label="Kind" @change=${(e: Event) => this.act(Input.ops.setKind, target(e).value)}>${KINDS.map(k => html`<option ?selected=${k === kind}>${k}</option>`)}</select>
      ${field}<button class="primary" @click=${() => this.act(Input.ops.submit)}>Send</button></div>${problem(this.problem)}`
  }
}

/** A slider and its value. */
export class RangeEl extends PlacedElement {
  static component = Range
  static styles = base
  render() {
    const [v, min, max, step] = [Range.ops.value, Range.ops.min, Range.ops.max, Range.ops.step].map(o => this.read<number>(o))
    return html`<div class="row"><input type="range" min=${min ?? 0} max=${max ?? 100} step=${step ?? 1} .value=${String(v ?? 0)}
      @input=${(e: Event) => this.act(Range.ops.set, Number(target(e).value))}><span class="mono">${v}</span></div>`
  }
}

/** A table of log entries, newest last, with Clear. */
export class LogEl extends PlacedElement {
  static component = Log
  static styles = [base, css`table { border-collapse: collapse; width: 100% } td, th { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--nano-border, #2A303C) }
    .warn { color: var(--nano-bad, #FFB4A8) } .debug { color: var(--nano-muted, #A3AAB8) }`]
  render() {
    const entries = this.read<Entry[]>(Log.ops.entries) ?? []
    return html`<div class="col"><div class="row"><span class="muted">${entries.length} entries</span><button @click=${() => this.act(Log.ops.clear)}>Clear</button></div>
      <table class="mono"><thead><tr><th>time</th><th>level</th><th>value</th></tr></thead><tbody>
      ${entries.map(e => html`<tr class=${e.level}><td>${new Date(e.time).toLocaleTimeString()}</td><td>${e.level}</td><td>${JSON.stringify(e.value)}</td></tr>`)}
      </tbody></table></div>`
  }
}

/** A code box over `x`, and a box to try a value on it. */
abstract class CodeEl extends PlacedElement {
  static styles = base
  /** The component's code ops, and the op that runs the code. */
  abstract ops: { code: Op; setCode: Op; run: Op }
  declare result?: unknown
  static properties = { ...PlacedElement.properties, result: { state: true } }
  render() {
    const ops = this.ops
    return html`<div class="col"><textarea class="mono" rows="3" .value=${this.read<string>(ops.code) ?? ''}
      @change=${(e: Event) => this.act(ops.setCode, target(e).value)}></textarea>
      <div class="row"><input placeholder="try a value (JSON)" @keydown=${async (e: KeyboardEvent) => {
        if (e.key !== 'Enter') return
        let x: unknown = target(e).value
        try { x = JSON.parse(String(x)) } catch {}
        const r = await this.act(ops.run, x); if ('value' in r) this.result = r.value
      }}><span class="mono">${JSON.stringify(this.result) ?? ''}</span></div>${problem(this.problem)}</div>`
  }
}
/** Map's element. */
export class MapEl extends CodeEl { static component = Map; ops = { ...Map.ops, run: Map.ops.map } }
/** Filter's element. */
export class FilterEl extends CodeEl { static component = Filter; ops = { ...Filter.ops, run: Filter.ops.filter } }

export { DebounceEl }

/** Defines every bundle element under its tag, once. */
export function defineBundle() {
  for (const [tag, el] of [['c-input', InputEl], ['c-range', RangeEl], ['c-log', LogEl], ['c-debounce', DebounceEl], ['c-map', MapEl], ['c-filter', FilterEl]] as const)
    if (!customElements.get(tag)) customElements.define(tag, el as unknown as CustomElementConstructor)
}
