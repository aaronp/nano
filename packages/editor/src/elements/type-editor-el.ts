// The type editor: a record's fields, and the type's look (preset, colour, or back to the one from its hash).
import { html, svg } from 'lit'
import type { TSchema } from 'typebox'
import { TypeEditor as E } from '../components/type-editor'
import { isBuiltin, lookFor, PRESET_LABELS, PRESET_ORDER, presetShape, SWATCHES, titleOf, type TypeEntry } from '../model'
import { base } from '@pritzlaff/nano-elements'
import { presetIcon } from './tiles'
import { typeNamed, typeOptions } from './types'
import { ModelElement } from '@pritzlaff/nano-elements'

/** Shows a type-editor model. `types` feed the field type pickers. */
export class TypeEditorEl extends ModelElement {
  static styles = base
  static properties = { ...ModelElement.properties, types: { attribute: false }, field: { state: true } }
  declare types: TypeEntry[]
  declare field?: { name: string; type: string }

  render() {
    const entry = this.read<TypeEntry>(E.ops.entry)
    if (!entry) return html`<div class="muted">Select a type to edit it.</div>`
    const builtin = isBuiltin(titleOf(entry.type))
    const look = lookFor(entry), props = (entry.type as { properties?: Record<string, TSchema> }).properties
    const pick = (name: string) => (e: Event) => {
      const t = typeNamed(this.types ?? [], (e.target as HTMLSelectElement).value)
      if (t) void this.act(E.ops.setField, { name, type: t.type })
    }
    return html`<div class="card col">
      <div class="row"><svg width="40" height="30" viewBox="0 0 40 30"><path d=${presetIcon(look.shape)} fill=${look.colour}></path></svg>
        <b class="mono">${titleOf(entry.type)}</b></div>
      ${builtin ? html`<div class="muted">Built-in types can't be changed.</div>` : ''}
      ${props && !builtin ? html`
        ${Object.entries(props).map(([name, t]) => html`<div class="row"><span class="mono">${name}</span>
          <select @change=${pick(name)}>${typeOptions(this.types ?? [], titleOf(t))}</select>
          <button aria-label="Remove field" @click=${() => this.act(E.ops.removeField, name)}>✕</button></div>`)}
        <div class="row"><input name="field-name" placeholder="field" @input=${(e: Event) => { this.field = { name: (e.target as HTMLInputElement).value, type: this.field?.type ?? 'string' } }}>
          <select name="field-type" @change=${(e: Event) => { this.field = { name: this.field?.name ?? '', type: (e.target as HTMLSelectElement).value } }}>${typeOptions(this.types ?? [], this.field?.type ?? 'string')}</select>
          <button class="dashed" @click=${this.addField}>+ Field</button></div>` : ''}
      ${builtin ? '' : html`<div class="row">${PRESET_ORDER.map(id => html`<button aria-label=${PRESET_LABELS[id]} @click=${() => this.act(E.ops.setLook, { ...look, shape: presetShape(id) })}>
        ${svg`<svg width="40" height="30" viewBox="0 0 40 30"><path d=${presetIcon(presetShape(id))} fill="#A3AAB8"></path></svg>`}</button>`)}</div>
      <div class="row">${SWATCHES.map(c => html`<button aria-label="Colour ${c}" style="width:24px;height:24px;padding:0;background:${c}" @click=${() => this.act(E.ops.setLook, { ...look, colour: c })}></button>`)}</div>
      <div class="row"><button @click=${() => this.act(E.ops.resetLook)}>Regenerate from hash</button></div>`}
      ${this.problem ? html`<div class="problem">${this.problem}</div>` : ''}
    </div>`
  }

  addField = async () => {
    const t = this.field && typeNamed(this.types ?? [], this.field.type)
    if (this.field?.name && t && 'value' in await this.act(E.ops.addField, { name: this.field.name, type: t.type })) this.field = undefined
  }
}
