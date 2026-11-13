// The example's elements: each places its component by `name` and is a thin view onto it.
import { css, html } from 'lit'
import { base, PlacedElement } from '@pritzlaff/nano-elements'
import type { Outcome, Stored } from './interfaces'
import { MemoryDb, type Entry } from './memory-db'
import { PersonForm } from './person-form'

const table = css`table { border-collapse: collapse; width: 100% } td, th { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--nano-border, #2A303C) }`
const said = (r: Outcome<string> | undefined, good: (id: string) => string) =>
  r ? html`<span class=${r.ok ? 'badge good' : 'problem'}>${r.ok ? good(r.value) : r.reason}</span>` : ''

/** What the DB holds: a row per entry. */
export class PeopleDbEl extends PlacedElement {
  static component = MemoryDb
  static styles = [base, table]
  render() {
    const entries = this.read<Entry[]>(MemoryDb.ops.entries) ?? []
    return html`<div class="col"><span class="muted">${entries.length} entries</span>
      <table class="mono"><thead><tr><th>key</th><th>value</th></tr></thead><tbody>
      ${entries.map(e => html`<tr><td>${e.key}</td><td>${JSON.stringify(e.value)}</td></tr>`)}
      </tbody></table></div>`
  }
}

/** A new person's name, email and postcode with Save; a name to look up; and the people saved. */
export class PersonFormEl extends PlacedElement {
  static component = PersonForm
  static styles = base
  static properties = { ...PlacedElement.properties, saved: { state: true }, found: { state: true } }
  declare saved?: Outcome<string>
  declare found?: Outcome<string>
  firstUpdated() { void this.act(PersonForm.ops.refresh) }
  render() {
    const people = this.read<Stored[]>(PersonForm.ops.people) ?? []
    const submit = async (e: SubmitEvent) => {
      e.preventDefault()
      const form = e.target as HTMLFormElement, r = await this.act(PersonForm.ops.submit, Object.fromEntries(new FormData(form)))
      if ('value' in r) { this.saved = r.value as Outcome<string>; if (this.saved.ok) form.reset() }
    }
    const lookup = async (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      const r = await this.act(PersonForm.ops.lookup, (e.target as HTMLInputElement).value)
      if ('value' in r) this.found = r.value as Outcome<string>
    }
    return html`<div class="col">
      <form class="col" @submit=${submit}><strong>New person</strong>
        <input name="name" placeholder="Name" required><input name="email" placeholder="Email"><input name="postcode" placeholder="Postcode">
        <div class="row"><button class="primary">Save</button>${said(this.saved, id => `saved as ${id}`)}</div></form>
      <strong>Look up</strong>
      <div class="row"><input placeholder="Name, then Enter" @keydown=${lookup}>${said(this.found, id => `id ${id}`)}</div>
      <strong>People</strong>
      <ul>${people.map(s => html`<li>${s.person.name} · ${s.person.postcode} <span class="muted">(${s.id})</span></li>`)}</ul>
      ${this.problem ? html`<div class="problem">${this.problem}</div>` : ''}</div>`
  }
}

/** Defines both elements under their tags, once. */
export function definePeople() {
  for (const [tag, el] of [['c-people-db', PeopleDbEl], ['c-person-form', PersonFormEl]] as const)
    if (!customElements.get(tag)) customElements.define(tag, el as unknown as CustomElementConstructor)
}
