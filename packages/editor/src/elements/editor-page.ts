// The whole editor on one page: Elements or Types on the left, the board on the right. It only passes data down.
import { css, html } from 'lit'
import type { Entry, Selection } from '../components/component-list'
import { ComponentList as L } from '../components/component-list'
import { TypeList as T } from '../components/type-list'
import { addEditor, editorIds, type Ids } from '../editor'
import type { TypeEntry } from '../model'
import { base, ModelElement, providedRegistry } from '@pritzlaff/nano-elements'

/** Lays out one editor: give it the `registry` and the `ids` from `addEditor`. Without them it uses the provided
 * registry, and the editor there (adding one if there is none). */
export class EditorPage extends ModelElement {
  static styles = [base, css`:host { background: #0D0F13; padding: 16px } .tabs button { flex: 1 }`]
  static properties = { ...ModelElement.properties, ids: { attribute: false }, tab: { state: true } }
  declare ids?: Ids
  declare tab: 'elements' | 'types'
  constructor() { super(); this.tab = 'elements' }

  connectedCallback() {
    if (!this.ids) {
      this.registry ??= providedRegistry(this.ownerDocument)
      if (this.registry) this.ids = this.registry.get(editorIds().list) ? editorIds() : addEditor(this.registry)
    }
    super.connectedCallback()
  }

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('ids') && this.ids) { this.model = this.ids.list; this.watch = [this.ids.types] }
    super.willUpdate(changed)
  }

  render() {
    if (!this.ids || !this.registry) return html``
    const types = this.read<TypeEntry[]>(T.ops.types) ?? [], components = this.read<Entry[]>(L.ops.components) ?? []
    const selected = this.read<Selection>(L.ops.selected) ?? {}, tab = (t: typeof this.tab, label: string) =>
      html`<button role="tab" aria-pressed=${this.tab === t} @click=${() => { this.tab = t }}>${label}</button>`
    return html`<div class="row" style="align-items:flex-start;gap:16px;flex-wrap:nowrap">
      <div class="col" style="width:340px">
        <div class="row tabs" role="tablist">${tab('elements', 'Elements')}${tab('types', 'Types')}</div>
        ${this.tab === 'elements'
          ? html`<component-list-el .registry=${this.registry} model=${this.ids.list} .types=${types}></component-list-el>`
          : html`<type-list-el .registry=${this.registry} model=${this.ids.types}></type-list-el>
                 <type-editor-el .registry=${this.registry} model=${this.ids.typeEditor} .types=${types}></type-editor-el>`}
      </div>
      <connection-board-el .registry=${this.registry} model=${this.ids.board} .types=${types} .components=${components} .selected=${selected}></connection-board-el>
    </div>`
  }
}
