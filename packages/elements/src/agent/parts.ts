// An agent at work, display only, on the AI SDK's message parts (as AI Elements shows them): <nano-tool> (a tool
// call), <nano-task> (a task and its items), <nano-subagent> (an agent and its tool calls) and <nano-cli> (commands).
import { LitElement, css, html, nothing } from 'lit'
import { base } from '../styles'
import { kit } from '../kit'
import { t } from '../tokens'

/** A tool part: `type` is `tool-<name>`, or `dynamic-tool` with `toolName`. */
export interface ToolPart { type: string; toolName?: string; toolCallId?: string; state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'; input?: unknown; output?: unknown; errorText?: string }
export interface TaskItem { text: string; status?: 'pending' | 'in_progress' | 'completed'; file?: { name: string } }
export interface Task { title: string; items: TaskItem[] }
export interface Subagent { name: string; description?: string; status: 'running' | 'completed' | 'error'; parts: ToolPart[]; result?: string }
export interface Run { command: string; output?: string; exitCode?: number; running?: boolean; cwd?: string }

const json = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))
const STATE = { 'input-streaming': ['Pending', ''], 'input-available': ['Running', 'accent'], 'output-available': ['Completed', 'good'], 'output-error': ['Error', 'bad'] } as const
const AGENT = { running: ['Running', 'accent'], completed: ['Completed', 'good'], error: ['Error', 'bad'] } as const
const ITEM = { completed: '✓', in_progress: '◐', pending: '○' } as const
const define = (tag: string, cls: CustomElementConstructor) => { if (globalThis.customElements && !customElements.get(tag)) customElements.define(tag, cls) }

/** What the agent pieces share: a card that opens, with a header row. */
export const agentStyles = css`
  details.card { padding: 0 } details.card > summary { display: flex; align-items: center; gap: 8px; padding: 9px 12px; cursor: pointer; list-style: none }
  details.card > summary::-webkit-details-marker { display: none }
  details.card > summary::after { content: '▾'; margin-left: 8px; color: ${t('muted')}; transition: transform .15s } details.card:not([open]) > summary::after { transform: rotate(-90deg) }
  details.card > summary .badge { margin-left: auto } .body { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 10px }
  .name { font-weight: 600 } .kicker { margin-bottom: 4px } .code { max-height: 220px }`

export class NanoTool extends LitElement {
  static override properties = { tool: { attribute: false } }
  static override styles = [base, kit, agentStyles]
  declare tool: ToolPart | undefined
  override render() {
    const p = this.tool
    if (!p) return nothing
    const [label, tone] = STATE[p.state]
    return html`<details class="card" ?open=${p.state === 'output-error'}><summary>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10.5 2.5a3 3 0 0 0-3.9 3.9L2.5 10.5l3 3 4.1-4.1a3 3 0 0 0 3.9-3.9l-2 2-2-2z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
        <span class="name">${p.toolName ?? p.type.replace(/^tool-/, '')}</span><span class="badge ${tone}">${label}</span></summary>
      <div class="body">
        <div data-part="input"><div class="kicker">Parameters</div><pre class="code">${json(p.input ?? {})}</pre></div>
        ${p.state === 'output-available' ? html`<div data-part="output"><div class="kicker">Result</div><pre class="code">${json(p.output)}</pre></div>` : nothing}
        ${p.state === 'output-error' ? html`<div class="alert bad">${p.errorText ?? 'The tool failed.'}</div>` : nothing}</div></details>`
  }
}

export class NanoTask extends LitElement {
  static override properties = { task: { attribute: false } }
  static override styles = [base, kit, agentStyles, css`
    ul { list-style: none; margin: 0; padding: 0 12px 12px; display: flex; flex-direction: column; gap: 6px }
    li { display: flex; gap: 8px; align-items: baseline } .icon { width: 14px; color: ${t('muted')} }
    li[data-status='completed'] { color: ${t('muted')} } li[data-status='completed'] .icon { color: ${t('good')} } li[data-status='in_progress'] .icon { color: ${t('accent')} }
    .file { margin-left: 4px } .count { color: ${t('muted')}; font-size: 12px; margin-left: auto } .count + .badge { margin-left: 0 }`]
  declare task: Task | undefined
  override render() {
    const k = this.task
    if (!k) return nothing
    const done = k.items.filter((i) => i.status === 'completed').length
    return html`<details class="card" open><summary><span class="title name">${k.title}</span><span class="count">${done}/${k.items.length}</span></summary>
      <ul>${k.items.map((i) => html`<li data-status=${i.status ?? 'pending'}><span class="icon" aria-hidden="true">${ITEM[i.status ?? 'pending']}</span>
        <span>${i.text}${i.file ? html`<span class="chip mono file">${i.file.name}</span>` : nothing}</span></li>`)}</ul></details>`
  }
}

export class NanoSubagent extends LitElement {
  static override properties = { agent: { attribute: false } }
  static override styles = [base, kit, agentStyles, css`.desc { color: ${t('muted')}; font-size: 12px } .body { border-left: 2px solid ${t('border')}; margin-left: 18px; padding-left: 12px }`]
  declare agent: Subagent | undefined
  override render() {
    const a = this.agent
    if (!a) return nothing
    const [label, tone] = AGENT[a.status]
    return html`<details class="card" open><summary><span class="avatar small" aria-hidden="true">${a.name.slice(0, 2).toUpperCase()}</span>
        <span class="col" style="gap:0"><span class="name">${a.name}</span>${a.description ? html`<span class="desc">${a.description}</span>` : nothing}</span>
        <span class="badge ${tone}">${label}</span></summary>
      <div class="body">${a.parts.map((p) => html`<nano-tool .tool=${p}></nano-tool>`)}${a.result ? html`<div class="bubble">${a.result}</div>` : nothing}</div></details>`
  }
}

export class NanoCli extends LitElement {
  static override properties = { runs: { attribute: false } }
  static override styles = [base, kit, css`
    .term { font: 12px/1.6 ${t('font-mono')}; background: ${t('surface-2')}; border: 1px solid ${t('border')}; border-radius: ${t('radius')}; padding: 10px 12px; overflow: auto }
    .run + .run { margin-top: 10px } .line { display: flex; gap: 8px; align-items: center } .prompt { color: ${t('accent')} } .cmd { font-weight: 600 }
    .cwd { color: ${t('muted')} } .exit { margin-left: auto } pre { margin: 2px 0 0; white-space: pre-wrap; color: ${t('fg-2')} }`]
  declare runs: Run[]
  constructor() { super(); this.runs = [] }
  override render() {
    return html`<div class="term">${this.runs.map((r) => html`<div class="run"><div class="line">${r.cwd ? html`<span class="cwd">${r.cwd}</span>` : nothing}
      <span class="prompt">$</span><span class="cmd">${r.command}</span>
      <span class="exit badge ${r.running ? 'accent' : r.exitCode === 0 ? 'good' : r.exitCode === undefined ? '' : 'bad'}">${r.running ? 'running…' : r.exitCode === undefined ? '' : `exit ${r.exitCode}`}</span></div>
      ${r.output ? html`<pre>${r.output}</pre>` : nothing}</div>`)}</div>`
  }
}

define('nano-tool', NanoTool); define('nano-task', NanoTask); define('nano-subagent', NanoSubagent); define('nano-cli', NanoCli)
