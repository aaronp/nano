// The Elements pane: components and their ops. Picking an op selects it (for the board); forms add and remove.
import { html } from 'lit'
import { Ops, type Op } from '@pritzlaff/nano-core'
import { ComponentList as L, type Entry, type Selection } from '../components/component-list'
import { titleOf, type TypeEntry } from '../model'
import { base } from '@pritzlaff/nano-elements'
import { typeNamed, typeOptions } from './types'
import { ModelElement } from '@pritzlaff/nano-elements'

/** Shows a component-list model. `types` feed the add-action form. */
export class ComponentListEl extends ModelElement {
  static styles = base
  static properties = { ...ModelElement.properties, types: { attribute: false }, form: { state: true } }
  declare types: TypeEntry[]
  declare form?: { kind: 'element'; name: string } | { kind: 'op'; component: string; name: string; input: string; output: string }

  render() {
    const comps = this.read<Entry[]>(L.ops.components) ?? [], sel = this.read<Selection>(L.ops.selected) ?? {}
    return html`<div class="col">
      ${comps.map(c => html`<div class="card col">
        <div class="row"><b>${c.id}</b><span style="flex:1"></span>
          <button aria-label="Add action to ${c.id}" @click=${() => { this.form = { kind: 'op', component: c.id, name: '', input: '', output: '' } }}>+</button>
          <button aria-label="Remove ${c.id}" @click=${() => this.act(L.ops.remove, c.id)}>✕</button></div>
        <div class="row">${c.ops.map(op => this.chip(c.id, op, sel))}</div>
        ${this.form?.kind === 'op' && this.form.component === c.id ? this.opForm() : ''}
      </div>`)}
      ${this.form?.kind === 'element'
        ? html`<div class="row"><input name="new-element" placeholder="name" @input=${(e: Event) => { this.form = { kind: 'element', name: (e.target as HTMLInputElement).value } }}>
            <button class="primary" @click=${this.addElement}>Add</button><button aria-label="Cancel" @click=${() => { this.form = undefined }}>✕</button></div>`
        : html`<button class="dashed" @click=${() => { this.form = { kind: 'element', name: '' } }}>+ Element</button>`}
      ${this.problem ? html`<div class="problem">${this.problem}</div>` : ''}
    </div>`
  }

  chip(component: string, op: Op, sel: Selection) {
    const key = Ops.key(op), io = `${op.input ? titleOf(op.input) : '·'} → ${op.output ? titleOf(op.output) : '·'}`
    return html`<span class="row" style="gap:2px">
      <button class="mono" aria-pressed=${sel.component === component && sel.op === key} @click=${() => this.act(L.ops.select, { component, op: key })}>${op.name} <span class="muted">${io}</span></button>
      <button aria-label="Remove ${op.name}" @click=${() => this.act(L.ops.removeOp, { component, op: key })}>✕</button></span>`
  }

  opForm() {
    const f = this.form as Extract<NonNullable<typeof this.form>, { kind: 'op' }>
    const set = (k: 'name' | 'input' | 'output') => (e: Event) => { this.form = { ...f, [k]: (e.target as HTMLInputElement).value } }
    return html`<div class="row">
      <input name="op-name" placeholder="action name" @input=${set('name')}>
      <label class="muted">in <select name="op-input" @change=${set('input')}><option value="">none</option>${typeOptions(this.types ?? [], f.input)}</select></label>
      <label class="muted">out <select name="op-output" @change=${set('output')}><option value="">none</option>${typeOptions(this.types ?? [], f.output)}</select></label>
      <button class="primary" @click=${this.addOp}>Add action</button><button @click=${() => { this.form = undefined }}>Cancel</button></div>`
  }

  addElement = async () => {
    if (this.form?.kind !== 'element' || !this.form.name) return
    if ('value' in await this.act(L.ops.add, { id: this.form.name, ops: [] })) this.form = undefined
  }

  addOp = async () => {
    const f = this.form
    if (f?.kind !== 'op' || !f.name) return
    const schema = (t: string) => (t ? typeNamed(this.types ?? [], t)?.type : undefined)
    const op: Op = { ns: `local/${f.component}`, name: f.name, input: schema(f.input), output: schema(f.output) }
    if ('value' in await this.act(L.ops.addOp, { component: f.component, op })) this.form = undefined
  }
}
