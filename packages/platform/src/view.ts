// <c-platform>: the platform as a tree (<nano-tree>), by system or by component. Select an action, then connect it
// to a fitting one; see which systems share a component; add components to systems; create new ones from the catalog.
import { css, html } from 'lit'
import type { TSchema } from 'typebox'
import { Ops, type Op, type Snapshot, type Subscription } from '@pritzlaff/nano-core'
import { base, ModelElement, providedRegistry, type NanoTree, type TreeNode } from '@pritzlaff/nano-elements'
import { PlatformOps as P, type Selection } from './platform'

type Inst = Snapshot['instances'][number]
const shown = (i: Inst) => i.id !== 'registry' && !i.id.includes('~view')
const typeLabel = (s?: TSchema): string => {
  const t = s as { title?: string; type?: string; items?: TSchema } | undefined
  return !t ? '·' : t.title ?? (t.type === 'array' ? `${typeLabel(t.items)}[]` : t.type ?? 'any')
}
/** The tree row a selection is: a component `c:<system>/<id>`, or an op `o:<system>/<id>/<key>`. */
const rowOf = (sel: Selection) => !sel ? null : sel.op ? `o:${sel.system}/${sel.instance}/${sel.op}` : `c:${sel.system}/${sel.instance}`
/** Each component's systems, in order. */
const membership = (systems: Snapshot[]) => {
  const where = new Map<string, string[]>()
  for (const s of systems) for (const i of s.instances.filter(shown)) where.set(i.id, [...(where.get(i.id) ?? []), s.id])
  return where
}

/** The platform's view. Uses the provided registry and the instance `platform` unless told otherwise. */
export class PlatformEl extends ModelElement {
  static styles = [base, css`.filter { flex: 1; min-width: 160px } nano-tree { margin-top: 4px }`]
  static properties = { ...ModelElement.properties, mode: { state: true }, filter: { state: true }, sharedOnly: { state: true }, form: { state: true }, target: { state: true } }
  declare mode: 'system' | 'component'
  declare filter: string
  declare sharedOnly: boolean
  declare form?: { kind: string; name: string; system: string }
  declare target: Record<string, string>
  #picks = new Map<string, Selection>()   // what each selectable row selects, from the last render
  constructor() { super(); this.mode = 'system'; this.filter = ''; this.sharedOnly = false; this.target = {} }

  connectedCallback() { this.registry ??= providedRegistry(this.ownerDocument); this.model ??= 'platform'; super.connectedCallback() }

  // a new selection, from here or elsewhere, opens the tree down to it and brings it into view (focus stays put)
  #shownSel = 'null'
  willUpdate(changed: Map<string, unknown>) {
    super.willUpdate(changed)
    const sel = this.read<Selection>(P.selected) ?? null, json = JSON.stringify(sel)
    if (json === this.#shownSel) return
    this.#shownSel = json
    const row = rowOf(sel)
    if (row) void this.updateComplete.then(() => this.renderRoot.querySelector<NanoTree>('nano-tree')?.reveal(row, { focus: false }))
  }

  #select(e: CustomEvent<{ id: string }>) {
    e.preventDefault()   // the platform's selection is what the tree shows
    const sel = this.#picks.get(e.detail.id)
    if (sel) void this.act(P.select, rowOf(this.read<Selection>(P.selected) ?? null) === e.detail.id ? null : sel)
  }

  render() {
    const systems = this.read<Snapshot[]>(P.systems) ?? [], sel = this.read<Selection>(P.selected) ?? null
    this.#picks = new Map()
    const nodes = this.mode === 'system' ? this.#bySystem(systems) : this.#byComponent(systems)
    const tab = (m: typeof this.mode, label: string) => html`<button aria-pressed=${this.mode === m} @click=${() => { this.mode = m }}>${label}</button>`
    return html`<div class="col">
      <div class="row"><input name="filter" type="search" class="filter" aria-label="Filter" placeholder="Filter systems, components, actions, types…"
          .value=${this.filter} @input=${(e: Event) => { this.filter = (e.target as HTMLInputElement).value }}>
        ${tab('system', 'By system')}${tab('component', 'By component')}
        <label class="row"><input type="checkbox" name="shared" .checked=${this.sharedOnly} @change=${(e: Event) => { this.sharedOnly = (e.target as HTMLInputElement).checked }}>Shared only</label>
        <button @click=${() => { this.form = this.form ? undefined : { kind: '', name: '', system: systems[0]?.id ?? '' } }}>+ Add</button></div>
      ${this.form ? this.#addForm(systems) : ''}
      <nano-tree open-depth=${this.mode === 'system' ? 1 : 0} .nodes=${nodes} .query=${this.filter} .selected=${this.mode === 'system' ? rowOf(sel) : null}
        @select=${(e: CustomEvent<{ id: string }>) => this.#select(e)}></nano-tree>
      ${this.problem ? html`<div class="problem">${this.problem}</div>` : ''}
    </div>`
  }

  // systems → components → ops, then the system's connections
  #bySystem(systems: Snapshot[]): TreeNode[] {
    const where = membership(systems)
    return systems.flatMap(s => {
      const insts = s.instances.filter(shown), listed = insts.filter(i => !this.sharedOnly || where.get(i.id)!.length > 1)
      if (this.sharedOnly && !listed.length) return []
      const conns = s.subscriptions.filter(sub => !sub.listener.includes('~view')).map(sub => this.#connection(s.id, sub))
      return [{ id: `s:${s.id}`, label: s.id, kind: 'system', count: insts.length, children: [...listed.map(i => this.#component(s, i, where.get(i.id)!)), ...conns] }]
    })
  }

  #component(s: Snapshot, i: Inst, in_: string[]): TreeNode {
    const id = `c:${s.id}/${i.id}`, others = in_.filter(x => x !== s.id)
    this.#picks.set(id, { system: s.id, instance: i.id })
    const jump = (to: string) => { this.filter = ''; void this.act(P.select, { system: to, instance: i.id }) }
    return {
      id, label: i.id, kind: 'component', badge: others.length ? `↗ ${in_.length} systems` : undefined,
      body: others.length ? html`<div class="row">Also in ${others.map(o => html`<button class="btn small" data-also="${o}/${i.id}" @click=${() => jump(o)}>↗ ${o}</button>`)}</div>` : undefined,
      children: i.ops.map(o => this.#op(s, i, o)),
    }
  }

  #op(s: Snapshot, i: Inst, o: Op): TreeNode {
    const sel = this.read<Selection>(P.selected), key = Ops.key(o), at = `${s.id}/${i.id}/${key}`, id = `o:${at}`
    this.#picks.set(id, { system: s.id, instance: i.id, op: key })
    const chosen = sel?.system === s.id && sel.instance === i.id && sel.op === key
    const from = sel?.op && sel.system === s.id ? s.instances.find(x => x.id === sel.instance)?.ops.find(x => Ops.key(x) === sel.op) : undefined
    const fits = !!from && !chosen && Ops.fits(from, o)
    return {
      id, label: o.name, kind: o.input ? 'action' : 'source', terms: [typeLabel(o.input), typeLabel(o.output)],
      body: html`<span class="mono">${typeLabel(o.input)} → ${typeLabel(o.output)}</span>`,
      end: fits ? html`<button class="btn small" data-connect=${at} title="Connect" aria-label="Connect to ${i.id} · ${o.name}"
        @click=${() => this.act(P.connect, { system: s.id, source: sel!.instance, op: sel!.op, listener: i.id, target: key })}>⇢</button>` : undefined,
    }
  }

  #connection(system: string, c: Subscription): TreeNode {
    return {
      id: `x:${system}/${c.id}`, label: `${c.source} · ${c.op} → ${c.listener} · ${c.target}`, kind: 'connection',
      end: html`<button class="btn small" aria-label="Disconnect" @click=${() => this.act(P.disconnect, { system, id: c.id })}>✕</button>`,
    }
  }

  // components → the systems they're in, with a picker to add them to another
  #byComponent(systems: Snapshot[]): TreeNode[] {
    return [...membership(systems)].filter(([, in_]) => !this.sharedOnly || in_.length > 1).map(([id, in_]) => {
      const others = systems.map(s => s.id).filter(s => !in_.includes(s))
      const to = others.includes(this.target[id] ?? '') ? this.target[id]! : others[0]   // a pick it is already in no longer counts
      return {
        id: `c:${id}`, label: id, kind: 'component', badge: in_.length > 1 ? `↗ ${in_.length} systems` : undefined, terms: in_,
        body: others.length ? html`<div class="row"><select name="add-to-${id}" aria-label="System to add ${id} to"
            @change=${(e: Event) => { this.target = { ...this.target, [id]: (e.target as HTMLSelectElement).value } }}>
            ${others.map(s => html`<option ?selected=${s === to}>${s}</option>`)}</select>
          <button class="btn small" aria-label="Add ${id} to system" @click=${() => this.act(P.addToSystem, { instance: id, from: in_[0], to })}>+</button></div>` : undefined,
        children: in_.map(s => ({ id: `m:${id}/${s}`, label: s, kind: 'system' })),
      }
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
