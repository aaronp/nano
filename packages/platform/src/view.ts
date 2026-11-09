// <c-platform>: the platform as a filterable tree, by system or by component. Select an action, then connect it
// to a fitting one; add components to systems; create new ones from the catalog.
import { css, html } from 'lit'
import type { TSchema } from 'typebox'
import { Ops, type Op, type Snapshot, type Subscription } from '@composable/core'
import { joins } from '@composable/editor'
import { base, ModelElement, providedRegistry } from '@composable/elements'
import { PlatformOps as P, type Selection } from './platform'

type Inst = Snapshot['instances'][number]
const shown = (i: Inst) => i.id !== 'registry' && !i.id.includes('~view')
const typeLabel = (s?: TSchema): string => {
  const t = s as { title?: string; type?: string; items?: TSchema } | undefined
  return !t ? '·' : t.title ?? (t.type === 'array' ? `${typeLabel(t.items)}[]` : t.type ?? 'any')
}

/** The platform's view. Uses the provided registry and the instance `platform` unless told otherwise. */
export class PlatformEl extends ModelElement {
  static styles = [base, css`
    .tree { display: flex; flex-direction: column; gap: 2px } .indent { padding-left: 16px }
    .op .connect { visibility: hidden } .op:hover .connect { visibility: visible }
    .toggle { border: 0; padding: 2px 4px; width: 22px } .types { padding-left: 40px; color: #A3AAB8 }`]
  static properties = { ...ModelElement.properties, mode: { state: true }, filter: { state: true }, open: { state: true }, form: { state: true }, target: { state: true } }
  declare mode: 'system' | 'component'
  declare filter: string
  declare open: Set<string>
  declare form?: { kind: string; name: string; system: string }
  declare target: Record<string, string>
  constructor() { super(); this.mode = 'system'; this.filter = ''; this.open = new Set(); this.target = {} }

  connectedCallback() { this.registry ??= providedRegistry(this.ownerDocument); this.model ??= 'platform'; super.connectedCallback() }

  // systems start open, everything below them closed; `open` holds the keys flipped from that; a filter opens all
  #is = (key: string) => this.filter !== '' || (key.startsWith('s:') !== this.open.has(key))
  #flip = (key: string) => { const o = new Set(this.open); o.has(key) ? o.delete(key) : o.add(key); this.open = o }
  #match = (...texts: string[]) => texts.some(t => t.toLowerCase().includes(this.filter.trim().toLowerCase()))
  #toggle = (key: string) => html`<button class="toggle" data-toggle=${key} @click=${() => this.#flip(key)}>${this.#is(key) ? '▾' : '▸'}</button>`

  render() {
    const systems = this.read<Snapshot[]>(P.systems) ?? []
    const tab = (m: typeof this.mode, label: string) => html`<button aria-pressed=${this.mode === m} @click=${() => { this.mode = m }}>${label}</button>`
    return html`<div class="col">
      <div class="row"><input name="filter" placeholder="Filter" .value=${this.filter} @input=${(e: Event) => { this.filter = (e.target as HTMLInputElement).value }}>
        ${tab('system', 'By system')}${tab('component', 'By component')}
        <button @click=${() => { this.form = this.form ? undefined : { kind: '', name: '', system: systems[0]?.id ?? '' } }}>+ Add</button></div>
      ${this.form ? this.#addForm(systems) : ''}
      <div class="tree">${this.mode === 'system' ? systems.map(s => this.#system(s)) : this.#byComponent(systems)}</div>
      ${this.problem ? html`<div class="problem">${this.problem}</div>` : ''}
    </div>`
  }

  #system(s: Snapshot) {
    const insts = s.instances.filter(shown).filter(i => this.#match(s.id, i.id, ...i.ops.flatMap(o => [o.name, typeLabel(o.input), typeLabel(o.output)])))
    if (!insts.length && !this.#match(s.id)) return ''
    return html`<div><div class="row">${this.#toggle(`s:${s.id}`)}<b>${s.id}</b></div>
      ${this.#is(`s:${s.id}`) ? html`<div class="indent">
        ${insts.map(i => this.#instance(s, i))}
        ${s.subscriptions.filter(sub => !sub.listener.includes('~view')).map(sub => this.#connection(s.id, sub))}</div>` : ''}</div>`
  }

  #instance(s: Snapshot, i: Inst) {
    const key = `c:${s.id}/${i.id}`, ops = i.ops.filter(o => this.#match(s.id, i.id, o.name, typeLabel(o.input), typeLabel(o.output)))
    return html`<div data-instance="${s.id}/${i.id}"><div class="row">${this.#toggle(key)}<span class="mono">${i.id}</span></div>
      ${this.#is(key) ? html`<div class="indent">${ops.map(o => this.#op(s, i, o))}</div>` : ''}</div>`
  }

  #op(s: Snapshot, i: Inst, o: Op) {
    const sel = this.read<Selection>(P.selected), key = Ops.key(o), at = `${s.id}/${i.id}/${key}`, typesKey = `o:${at}`
    const chosen = sel?.system === s.id && sel.instance === i.id && sel.op === key
    const from = sel?.op && sel.system === s.id ? s.instances.find(x => x.id === sel.instance)?.ops.find(x => Ops.key(x) === sel.op) : undefined
    const fits = !!from && !chosen && joins(from, o)
    return html`<div class="op"><div class="row">${this.#toggle(typesKey)}
      <button class="mono" data-op=${at} aria-pressed=${chosen} @click=${() => this.act(P.select, chosen ? null : { system: s.id, instance: i.id, op: key })}>${o.name}</button>
      ${fits ? html`<button class="connect" data-connect=${at} title="Connect" @click=${() => this.act(P.connect, { system: s.id, source: sel!.instance, op: sel!.op, listener: i.id, target: key })}>⇢</button>` : ''}</div>
      ${this.#is(typesKey) ? html`<div class="types mono">${typeLabel(o.input)} → ${typeLabel(o.output)}</div>` : ''}</div>`
  }

  #connection(system: string, c: Subscription) {
    return html`<div class="row connection mono">${c.source} · ${c.op} → ${c.listener} · ${c.target}
      <button aria-label="Disconnect" @click=${() => this.act(P.disconnect, { system, id: c.id })}>✕</button></div>`
  }

  #byComponent(systems: Snapshot[]) {
    const where = new Map<string, string[]>()
    for (const s of systems) for (const i of s.instances.filter(shown)) where.set(i.id, [...(where.get(i.id) ?? []), s.id])
    return [...where].filter(([id, in_]) => this.#match(id, ...in_)).map(([id, in_]) => {
      const others = systems.map(s => s.id).filter(s => !in_.includes(s)), to = this.target[id] ?? others[0]
      return html`<div><div class="row">${this.#toggle(`c:${id}`)}<span class="mono">${id}</span></div>
        ${this.#is(`c:${id}`) ? html`<div class="indent">${in_.map(s => html`<div class="mono">${s}</div>`)}
          ${others.length ? html`<div class="row"><select name="add-to-${id}" @change=${(e: Event) => { this.target = { ...this.target, [id]: (e.target as HTMLSelectElement).value } }}>
            ${others.map(s => html`<option ?selected=${s === to}>${s}</option>`)}</select>
            <button aria-label="Add ${id} to system" @click=${() => this.act(P.addToSystem, { instance: id, from: in_[0], to: this.target[id] ?? others[0] })}>+</button></div>` : ''}</div>` : ''}</div>`
    })
  }

  #addForm(systems: Snapshot[]) {
    const kinds = this.read<string[]>(P.catalog) ?? [], f = this.form!, set = (k: keyof typeof f) => (e: Event) => { this.form = { ...this.form!, [k]: (e.target as HTMLInputElement).value } }
    return html`<div class="row card">
      <select name="kind" @change=${set('kind')}><option value="">kind…</option>${kinds.map(k => html`<option ?selected=${k === f.kind}>${k}</option>`)}</select>
      <input name="name" placeholder="name" @input=${set('name')}>
      <select name="system" @change=${set('system')}>${systems.map(s => html`<option ?selected=${s.id === f.system}>${s.id}</option>`)}</select>
      <button class="primary" @click=${async () => { if ('value' in await this.act(P.createComponent, this.form)) this.form = undefined }}>Create</button>
      <input name="new-system" placeholder="new system" @keydown=${async (e: KeyboardEvent) => {
        const i = e.target as HTMLInputElement
        if (e.key === 'Enter' && i.value && 'value' in await this.act(P.createSystem, i.value)) i.value = ''
      }}></div>`
  }
}

/** Defines `<c-platform>`, once. */
export const definePlatform = () => { if (!customElements.get('c-platform')) customElements.define('c-platform', PlatformEl) }
