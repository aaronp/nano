/**
 * <puzzle-editor>: the whole editor. A left panel (Elements / Types tabs) and the board, bound to the children of the
 * puzzleEditor composite, plus the status line, Show model and Clear all. It acts only through the composite's ops.
 */
import { css, nothing } from 'lit'
import { html, unsafeStatic } from 'lit/static-html.js'
import type { PropertyValues } from 'lit'
import type { Created, Result } from '@composable/sdk'
import { View, base, t } from '@composable/ui'
import { board as bm, emptyEditorDoc } from '../model'
import { DocumentOps, puzzleEditor } from '../components'

export class PuzzleEditorView extends View<Created<typeof puzzleEditor>> {
  static factory = puzzleEditor
  #tab: 'elements' | 'types' = 'elements'
  #showModel = false
  #error = ''
  #offs: (() => void)[] = []

  /** The status line and the model follow the board and the document children. */
  protected override willUpdate(changed: PropertyValues) {
    super.willUpdate(changed)
    if (!changed.has('component')) return
    this.#offs.forEach(off => off())
    const { board, document } = this.component?.children ?? {}
    this.#offs = [board, document].flatMap(c => c ? [c.onChange(() => this.requestUpdate())] : [])
  }
  override disconnectedCallback() { super.disconnectedCallback(); this.#offs.forEach(off => off()); this.#offs = [] }

  /** Clear all is a load of the empty document. */
  async #clear() {
    const h = this.component.children.document.systems[0]   // the composite's own handle is outside; load is exposed straight from this child
    let r: Result<unknown>
    try { r = h ? await h.call(h.instanceId, DocumentOps.load, emptyEditorDoc()) : { type: 'error', error: { code: 'unavailable', message: 'not in a System' } } }
    catch (e) { r = { type: 'error', error: { code: 'handler', message: String((e as Error)?.message ?? e) } } }
    this.#error = r.type === 'success' ? '' : r.type === 'error' ? r.error.message : r.reason
    this.requestUpdate()
  }

  override render() {
    const { types, list, board, document } = this.component.children
    const { connections, status } = board.state
    const placed = bm.board(connections).length, n = connections.intents.length
    const problems = Object.values(status).reduce((sum, s) => sum + s.problems.length, 0)
    const p = this.localName.replace(/puzzle-editor$/, '')   // child tags carry the same prefix (see defineEditor)
    const cl = unsafeStatic(`${p}component-list`), te = unsafeStatic(`${p}type-editor`), ce = unsafeStatic(`${p}connection-editor`)
    const tab = (id: 'elements' | 'types', label: string) => html`<button class="tab-${id}" aria-pressed=${this.#tab === id} @click=${() => { this.#tab = id; this.requestUpdate() }}>${label}</button>`
    return html`
      <aside class="left">
        <div class="tabs" role="group" aria-label="Panel">${tab('elements', 'Elements')}${tab('types', 'Types')}</div>
        ${this.#tab === 'elements' ? html`<${cl} .component=${list}></${cl}>` : html`<${te} .component=${types}></${te}>`}
      </aside>
      <main>
        <div class="bar">
          <span class="status-line">${placed} placed · ${n} connection${n === 1 ? '' : 's'} · ${problems} problem${problems === 1 ? '' : 's'}</span>
          ${this.#error ? html`<span class="problem">${this.#error}</span>` : nothing}
          <span class="grow"></span>
          <button class="show-model" @click=${() => { this.#showModel = !this.#showModel; this.requestUpdate() }}>${this.#showModel ? 'Hide model' : 'Show model'}</button>
          <button class="clear-all" @click=${() => void this.#clear()}>Clear all</button>
        </div>
        ${this.#showModel ? html`<div class="model"><pre>${JSON.stringify(document.state.doc, null, 2)}</pre></div>` : nothing}
        <${ce} .component=${board}></${ce}>
      </main>`
  }

  static styles = [base, css`
    :host { display: grid; grid-template-columns: minmax(240px, 320px) minmax(0, 1fr); gap: ${t.gap}; align-items: start; }
    .left, main { display: grid; gap: ${t.gap}; align-content: start; min-width: 0; }
    .tabs { display: flex; gap: 4px; border: 1px solid ${t.line}; border-radius: ${t.radius}; padding: 3px; }
    .tabs button { flex: 1; border: 0; background: transparent; color: ${t.fg}; padding: 6px 0; border-radius: ${t.radius}; cursor: pointer; }
    .tabs button[aria-pressed=true] { background: ${t.surface}; font-weight: 600; }
    .bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; } .grow { flex: 1; }
    .status-line { color: ${t.muted}; } .problem { color: ${t.danger}; font-size: .8rem; }
    .model pre { margin: 0; max-height: 300px; overflow: auto; background: ${t.surface}; border: 1px solid ${t.line}; border-radius: ${t.radius}; padding: 10px; font: 12px/1.4 ${t.mono}; }
    button { cursor: pointer; }
  `]
}

/** Register as `<${tag}>` (default `puzzle-editor`); a no-op if taken. */
export const definePuzzleEditor = (tag = 'puzzle-editor') => { if (!customElements.get(tag)) customElements.define(tag, PuzzleEditorView) }
