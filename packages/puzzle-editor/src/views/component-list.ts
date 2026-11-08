/** <component-list>: the Elements tab of a component-list component. Reads its state; acts only by calling its ops. */
import { css, html, nothing } from 'lit'
import type { TSchema } from 'typebox'
import type { Created, Input, Op, Result } from '@composable/sdk'
import { View, base, t } from '@composable/ui'
import { componentsOf, nameOf, type DraftOp, type TypeRef } from '../model'
import { ComponentListOps as O, componentList } from '../components'

const AUTHOR = 'me'

export class ComponentListView extends View<Created<typeof componentList>> {
  static factory = componentList
  #error = ''
  /** Which form is open: '' for a new element, a component key for a new op. */
  #adding?: string
  #name = ''

  async #act<P extends Op<TSchema, TSchema | undefined>>(op: P, input: Input<P>) {
    const h = this.component.systems[0]
    let r: Result<unknown>
    try { r = h ? await h.call(h.instanceId, op, input) : { type: 'error', error: { code: 'unavailable', message: 'not in a System' } } }
    catch (e) { r = { type: 'error', error: { code: 'handler', message: String((e as Error)?.message ?? e) } } }
    this.#error = r.type === 'success' ? '' : r.type === 'error' ? r.error.message : r.reason
    if (r.type === 'success') this.#adding = undefined
    this.requestUpdate()
  }
  #open(key: string | undefined) { this.#adding = key; this.#name = ''; this.#error = ''; this.requestUpdate() }

  #form(cls: string, label: string, save: () => void) {
    return html`<div class=${cls}>
      <input type="text" aria-label=${label} placeholder=${label} .value=${this.#name} @input=${(e: Event) => { this.#name = (e.target as HTMLInputElement).value }}>
      <button @click=${save}>Add</button>
      <button aria-label="Cancel" @click=${() => this.#open(undefined)}>✕</button>
    </div>`
  }

  /** A type picker plus an array switch for one end of an op. */
  #picker(c: { author: string; id: string }, op: DraftOp, end: 'input' | 'output') {
    const ref = op[end]
    const set = (r: TypeRef | null) => void this.#act(O.setOpTypes, { component: c, name: op.name, [end]: r })
    return html`<label>${end}
      <select class=${end} @change=${(e: Event) => { const v = (e.target as HTMLSelectElement).value; set(v ? { type: v, array: ref?.array ?? false } : null) }}>
        <option value="" ?selected=${!ref}>(none)</option>
        ${this.component.state.types.map(ty => html`<option value=${ty.id} ?selected=${ref?.type === ty.id}>${nameOf(ty)}</option>`)}
      </select></label>
      <label><input type="checkbox" class="${end}-array" .checked=${ref?.array ?? false} ?disabled=${!ref}
        @change=${(e: Event) => { if (ref) set({ type: ref.type, array: (e.target as HTMLInputElement).checked }) }}> []</label>`
  }

  override render() {
    const { drafts, types, instances } = this.component.state
    return html`
      ${this.#adding === '' ? this.#form('new-element', 'Element name, e.g. payments', () => void this.#act(O.addDraft, { id: { author: AUTHOR, id: this.#name } }))
        : html`<button class="add-element" @click=${() => this.#open('')}>+ Element</button>`}
      ${this.#error ? html`<p class="problem error">${this.#error}</p>` : nothing}
      ${drafts.length || instances.length ? nothing : html`<p class="muted">An element is a namespace for ops. Add one, then use its + to add ops.</p>`}
      ${componentsOf(drafts, types, instances).map(e => {
        const id = e.manifest.id, key = `${id.author}/${id.id}`
        const editable = e.draft && !e.implemented
        return html`
          <section data-component=${key} class="${e.draft ? 'draft' : ''} ${e.draft && e.implemented ? 'implemented' : ''}">
            <h4>${key} ${e.draft ? html`<small class="badge">${e.implemented ? 'draft, implemented' : 'draft'}</small>` : nothing}
              ${editable ? html`<button class="add-op" aria-label="Add op to ${key}" @click=${() => this.#open(key)}>+</button>
                <button class="remove" aria-label="Remove ${key}" @click=${() => void this.#act(O.removeDraft, { component: id })}>✕</button>` : nothing}</h4>
            ${e.problem ? html`<div class="problem">${e.problem}</div>` : nothing}
            ${this.#adding === key ? this.#form('new-op', 'Op name', () => void this.#act(O.addOp, { component: id, name: this.#name })) : nothing}
            ${editable
              ? drafts.find(d => d.id.author === id.author && d.id.id === id.id)!.ops.map(op => html`
                <div class="op" data-op=${op.name}><b>${op.name}</b> ${this.#picker(id, op, 'input')} ${this.#picker(id, op, 'output')}
                  <button class="remove-op" aria-label="Remove ${op.name}" @click=${() => void this.#act(O.removeOp, { component: id, name: op.name })}>✕</button></div>`)
              : e.manifest.ops.map(op => html`<div class="op" data-op=${op.name.split('/').pop()}><code>${op.name.split('/').pop()}</code></div>`)}
          </section>`
      })}`
  }

  static styles = [base, css`
    :host { display: grid; gap: ${t.gap}; align-content: start; }
    section { border-top: 1px solid ${t.line}; padding-top: ${t.gap}; }
    section.draft { border-left: 3px solid ${t.accent}; padding-left: 6px; }
    section.implemented { border-left-style: dashed; }
    h4 { margin: 0 0 4px; font-size: .85rem; display: flex; align-items: center; gap: 6px; }
    .badge { color: ${t.muted}; font-weight: 400; flex: 1; }
    .op { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: .85rem; margin: 4px 0; }
    .new-element, .new-op { display: flex; gap: 6px; } .new-element input, .new-op input { flex: 1; min-width: 0; }
    .muted { color: ${t.muted}; font-size: .85rem; } .problem { color: ${t.danger}; font-size: .8rem; }
  `]
}

/** Register as `<${tag}>` (default `component-list`); a no-op if taken. */
export const defineComponentList = (tag = 'component-list') => { if (!customElements.get(tag)) customElements.define(tag, ComponentListView) }
