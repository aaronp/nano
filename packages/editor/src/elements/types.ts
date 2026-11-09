// Shared bits for elements that pick types: options for a select, and finding a type by title.
import { html } from 'lit'
import { lookFor, titleOf, type Look, type TypeEntry } from '../model'

/** `<option>`s for every type, with `selected` marked. */
export const typeOptions = (types: readonly TypeEntry[], selected?: string) =>
  types.map(e => html`<option value=${titleOf(e.type)} ?selected=${titleOf(e.type) === selected}>${titleOf(e.type)}</option>`)

/** The type with this title, if any. */
export const typeNamed = (types: readonly TypeEntry[], title: string) => types.find(e => titleOf(e.type) === title)

/** How a schema is drawn: the list's hand-picked look for its title, or the one from its hash. */
export const lookOfSchema = (types: readonly TypeEntry[], schema: TypeEntry['type']): Look =>
  lookFor(typeNamed(types, titleOf(schema)) ?? { type: schema })
