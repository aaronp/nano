// <nano-trace>: OpenTelemetry-style spans as a timeline (children under parents, bars placed by time), and
// <nano-test-results>: a run's summary, a bar per outcome, and its suites with failing tests open.
import { LitElement, css, html, nothing } from 'lit'
import { base } from '../styles'
import { kit } from '../kit'
import { t, tv, type NanoToken } from '../tokens'
import { agentStyles } from './parts'

export interface Span { spanId: string; parentSpanId?: string; name: string; startTime: number; endTime: number; status?: 'ok' | 'error' | 'unset' }
export interface TestCase { name: string; status: 'passed' | 'failed' | 'skipped'; duration?: number; error?: { message: string; stack?: string } }
export interface TestResults { summary: { passed: number; failed: number; skipped: number; total: number; duration?: number }; suites: { name: string; tests: TestCase[] }[] }

/** Milliseconds, as `200ms` or `1.23s`. */
const ms = (n: number) => (n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(2)}s`)
const pct = (n: number) => `${+n.toFixed(2)}%`

/** Spans in tree order (parents first, siblings by start), each with its depth. A span whose parent is missing is a root. */
const ordered = (spans: Span[]) => {
  const ids = new Set(spans.map((s) => s.spanId)), out: { span: Span; depth: number }[] = []
  const walk = (parent: string | undefined, depth: number) => spans
    .filter((s) => (parent === undefined ? !s.parentSpanId || !ids.has(s.parentSpanId) : s.parentSpanId === parent))
    .sort((a, b) => a.startTime - b.startTime)
    .forEach((s) => { out.push({ span: s, depth }); walk(s.spanId, depth + 1) })
  walk(undefined, 0)
  return out
}

export class NanoTrace extends LitElement {
  static override properties = { spans: { attribute: false } }
  static override styles = [base, kit, css`
    .frame { border: 1px solid ${t('border')}; border-radius: ${t('radius')}; padding: 8px 0 }
    .head, .span { display: grid; grid-template-columns: minmax(120px, 30%) 1fr 64px; align-items: center; gap: 8px; padding: 3px 12px }
    .head { color: ${t('muted')}; font-size: 11px; border-bottom: 1px solid ${t('border')}; padding-bottom: 6px; margin-bottom: 4px }
    .span:hover { background: ${t('surface-2')} } .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
    .track { position: relative; height: 14px } .bar { position: absolute; top: 2px; bottom: 2px; min-width: 2px; border-radius: 3px }
    .bar.bad { background: ${t('bad')} !important } .dur, .total { text-align: right; color: ${t('muted')}; font: 11px ${t('font-mono')} }`]
  declare spans: Span[]
  constructor() { super(); this.spans = [] }
  override render() {
    if (!this.spans.length) return nothing
    const t0 = Math.min(...this.spans.map((s) => s.startTime)), total = Math.max(...this.spans.map((s) => s.endTime)) - t0 || 1
    return html`<div class="frame"><div class="head"><span>Span</span><span>Timeline</span><span class="total">${ms(total)}</span></div>
      ${ordered(this.spans).map(({ span: s, depth }) => html`<div class="span" data-depth=${depth} title=${`${s.name}: ${ms(s.endTime - s.startTime)}`}>
        <span class="label" style=${`padding-left:${depth * 14}px`}>${s.name}</span>
        <span class="track"><span class="bar ${s.status === 'error' ? 'bad' : ''}" style=${`left:${pct(((s.startTime - t0) / total) * 100)};width:${pct(((s.endTime - s.startTime) / total) * 100)};background:${tv(`s${(depth % 8) + 1}` as NanoToken)}`}></span></span>
        <span class="dur">${ms(s.endTime - s.startTime)}</span></div>`)}</div>`
  }
}

const MARK = { passed: '✓', failed: '✕', skipped: '–' } as const
export class NanoTestResults extends LitElement {
  static override properties = { results: { attribute: false } }
  static override styles = [base, kit, agentStyles, css`
    .summary { display: flex; align-items: center; gap: 8px; margin-bottom: 8px } .dur { margin-left: auto; color: ${t('muted')}; font: 11px ${t('font-mono')} }
    .bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: ${t('surface-2')}; margin-bottom: 12px }
    .seg.passed { background: ${t('good')} } .seg.failed { background: ${t('bad')} } .seg.skipped { background: ${t('muted')} }
    .suites { display: flex; flex-direction: column; gap: 8px } .tests { list-style: none; margin: 0; padding: 0 12px 10px }
    .test { display: grid; grid-template-columns: 16px 1fr auto; gap: 6px; padding: 3px 0 } .test .alert { grid-column: 2 / -1; font: 11px ${t('font-mono')}; white-space: pre-wrap }
    .test.passed .mark { color: ${t('good')} } .test.failed .mark { color: ${t('bad')} } .test.skipped { color: ${t('muted')} }
    .test .ms { color: ${t('muted')}; font: 11px ${t('font-mono')} } summary .muted { font-size: 12px }`]
  declare results: TestResults | undefined
  override render() {
    const r = this.results
    if (!r) return nothing
    const { summary: s } = r, tone = { passed: 'good', failed: 'bad', skipped: '' } as const
    return html`<div class="summary">${(['passed', 'failed', 'skipped'] as const).map((k) => html`<span class="badge ${tone[k]}" data-count=${k}>${s[k]} ${k}</span>`)}
        ${s.duration !== undefined ? html`<span class="dur">${ms(s.duration)}</span>` : nothing}</div>
      <div class="bar" role="img" aria-label=${`${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped of ${s.total}`}>
        ${(['passed', 'failed', 'skipped'] as const).map((k) => html`<span class="seg ${k}" style=${`width:${pct((s[k] / (s.total || 1)) * 100)}`}></span>`)}</div>
      <div class="suites">${r.suites.map((suite) => {
        const failed = suite.tests.filter((x) => x.status === 'failed').length
        return html`<details class="card suite" ?open=${failed > 0}><summary><span class="name">${suite.name}</span>
          <span class="muted">${suite.tests.length - failed}/${suite.tests.length}</span>${failed ? html`<span class="badge bad">${failed} failed</span>` : nothing}</summary>
          <ul class="tests">${suite.tests.map((x) => html`<li class="test ${x.status}"><span class="mark" aria-label=${x.status}>${MARK[x.status]}</span><span>${x.name}</span>
            <span class="ms">${x.duration !== undefined ? ms(x.duration) : ''}</span>${x.error ? html`<div class="alert bad">${x.error.message}</div>` : nothing}</li>`)}</ul></details>`
      })}</div>`
  }
}

for (const [tag, cls] of [['nano-trace', NanoTrace], ['nano-test-results', NanoTestResults]] as const)
  if (globalThis.customElements && !customElements.get(tag)) customElements.define(tag, cls)
