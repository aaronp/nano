// The Types pane's list: select, create, rename, copy as brand, delete.
import { html } from 'lit'
import { TypeList as T } from '../components/type-list'
import { isBuiltin, titleOf, type TypeEntry } from '../model'
import { base } from './styles'
import { ModelElement } from './view'

/** Shows a type-list model. */
export class TypeListEl extends ModelElement {
  static styles = base
  static properties = { ...ModelElement.properties, draft: { state: true }, rename: { state: true }, brand: { state: true } }
  declare draft?: string
  declare rename?: string
  declare brand?: string

  render() {
    const types = this.read<TypeEntry[]>(T.ops.types) ?? [], selected = this.read<string>(T.ops.selected)
    const value = (f: (v: string) => void) => (e: Event) => f((e.target as HTMLInputElement).value)
    return html`<div class="col">
      ${types.map(e => html`<button class="mono" style="text-align:left" aria-pressed=${titleOf(e.type) === selected}
        @click=${() => this.act(T.ops.select, titleOf(e.type))}>${titleOf(e.type)}</button>`)}
      ${this.draft === undefined
        ? html`<button class="dashed" @click=${() => { this.draft = '' }}>+ New record type</button>`
        : html`<div class="row"><input name="new-type" placeholder="Name" @input=${value(v => { this.draft = v })}>
            <button class="primary" @click=${this.create}>Create</button><button aria-label="Cancel" @click=${() => { this.draft = undefined }}>✕</button></div>`}
      ${selected && !isBuiltin(selected) ? html`<div class="card col">
        <div class="row"><input name="rename" placeholder=${selected} @input=${value(v => { this.rename = v })}>
          <button @click=${() => this.rename && this.act(T.ops.rename, { from: selected, to: this.rename })}>Rename</button></div>
        <div class="row"><input name="brand" placeholder="Brand name" @input=${value(v => { this.brand = v })}>
          <button @click=${() => this.brand && this.act(T.ops.copyAsBrand, { from: selected, to: this.brand })}>Copy as brand</button>
          <button class="danger" @click=${() => this.act(T.ops.remove, selected)}>Delete</button></div>
      </div>` : ''}
      ${this.problem ? html`<div class="problem">${this.problem}</div>` : ''}
    </div>`
  }

  create = async () => {
    if (this.draft && 'value' in await this.act(T.ops.add, this.draft)) this.draft = undefined
  }
}
