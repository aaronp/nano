// The Address → Jurisdiction components from packages/connections/test/connections.test.ts.
import Type from 'typebox'
import { Components, ok } from '@composable/sdk'

export const flush = () => new Promise(r => setTimeout(r, 0))
const Address = Type.Object({ street: Type.String(), city: Type.String(), country: Type.String() }, { $id: 'geo.Address' })
const Jurisdiction = Type.Object({ city: Type.String(), country: Type.String() }, { $id: 'geo.Jurisdiction' })

const Crm = Components.declare({ author: 't', id: 'crm' })
export const updated = Crm.op('address-updated', 'An address changed', { output: Address })
export const crm = Crm.define({ state: () => null })
const Map_ = Components.declare({ author: 't', id: 'map' })
export const toJ = Map_.op('to-jurisdiction', 'Address → Jurisdiction', { input: Address, output: Jurisdiction })
export const mapper = Map_.define({ state: () => null, handlers: [[toJ, ({ city, country }) => ok({ city: city.toLowerCase(), country })]] })
const Tax = Components.declare({ author: 't', id: 'tax' })
export const rate = Tax.op('rate-for', 'Set the jurisdiction', { input: Jurisdiction })
export const tax = Tax.define({ state: () => [] as unknown[], handlers: [[rate, (j, { state }) => { state.push(j) }]] })
