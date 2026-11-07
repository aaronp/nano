import { test, expect } from 'bun:test'
import Type from 'typebox'
import { Components, Scopes, ok, typeHash } from '@composable/sdk'
import { Orchestrators, plan, type Intent } from '../src'

const flush = () => new Promise(r => setTimeout(r, 0))
const Address = Type.Object({ street: Type.String(), city: Type.String(), country: Type.String() }, { $id: 'geo.Address' })
const Jurisdiction = Type.Object({ city: Type.String(), country: Type.String() }, { $id: 'geo.Jurisdiction' })

// crm publishes addressUpdated (Address)
const Crm = Components.declare({ author: 't', id: 'crm' })
const addressUpdated = Crm.op('address-updated', 'An address changed', { output: Address })
const crm = Crm.define({ state: () => null })
// map: Address → Jurisdiction (an action: its outcome is a source)
const Map_ = Components.declare({ author: 't', id: 'map' })
const toJurisdiction = Map_.op('to-jurisdiction', 'Address → Jurisdiction', { input: Address, output: Jurisdiction })
const mapper = Map_.define({ state: () => null, handlers: [[toJurisdiction, ({ city, country }) => ok({ city: city.toLowerCase(), country })]] })
// tax takes a Jurisdiction
const Tax = Components.declare({ author: 't', id: 'tax' })
const rateFor = Tax.op('rate-for', 'Set the jurisdiction', { input: Jurisdiction })
const tax = () => { const seen: unknown[] = []; return Object.assign(Tax.define({ state: () => seen, handlers: [[rateFor, (j, { state }) => { state.push(j) }]] }), { seen }) }
// logger takes anything
const Log = Components.declare({ author: 't', id: 'log' })
const log = Log.op('log', 'Record anything', { input: Type.Unknown() })
const logger = () => { const seen: string[] = []; return Object.assign(Log.define({ state: () => null, handlers: [[log, (_x, { inv }) => { seen.push(`${inv.from}:${inv.via?.split('/').pop()}`) }]] }), { seen }) }

const workflow: Intent = { kind: 'workflow', id: 'address-to-tax', steps: [
  { select: { by: 'name', name: 'crm' }, op: addressUpdated.name },
  { select: { by: 'component', id: { author: 't', id: 'map' } }, op: toJurisdiction.name },
  { select: { by: 'name', name: 'tax' }, op: rateFor.name },
] }
const logEverything: Intent = { kind: 'connection', id: 'log-all',
  from: { select: { by: 'any' }, output: { by: 'outputs' } }, to: { select: { by: 'component', id: { author: 't', id: 'log' } }, op: log.name } }

test('plan: a workflow is viable only when every step resolves to one instance and the types fit', () => {
  // setup: just crm and tax: Address cannot feed a Jurisdiction input
  const inst = (name: string, f: { manifest: any }) => ({ name, manifest: f.manifest })
  const direct: Intent = { kind: 'workflow', id: 'direct', steps: [workflow.kind === 'workflow' ? workflow.steps[0] : undefined!, workflow.steps[2]] }
  // call out our method under test
  const p = plan([direct, workflow], [inst('crm', crm), inst('tax', tax())])
  // the direct chain is a type mismatch (with both SAIDs); the full chain is missing its map step
  expect(p.status.direct).toMatchObject({ viable: false, problems: [{ kind: 'type-mismatch', output: typeHash(Address), input: typeHash(Jurisdiction) }] })
  expect(p.status['address-to-tax'].problems).toEqual([{ kind: 'no-match', at: 'step 1' }])
  expect(p.routes).toEqual([])
  // two maps: ambiguous, and it says which
  const two = plan([workflow], [inst('crm', crm), inst('m1', mapper), inst('m2', mapper), inst('tax', tax())])
  expect(two.status['address-to-tax'].problems).toEqual([{ kind: 'ambiguous', at: 'step 1', instances: ['m1', 'm2'] }])
  // one map: viable, two routes
  const ok1 = plan([workflow], [inst('crm', crm), inst('m', mapper), inst('tax', tax())])
  expect(ok1.status['address-to-tax']).toMatchObject({ viable: true, routes: 2, problems: [] })
  expect(ok1.routes.map(r => `${r.from}→${r.to}`)).toEqual(['crm→m', 'm→tax'])
})

test('plan: a connection fans out, never feeds an instance its own output, and can be switched off', () => {
  const inst = (name: string, f: { manifest: any }) => ({ name, manifest: f.manifest })
  const l = logger()
  const instances = [inst('crm', crm), inst('m', mapper), inst('log', l)]
  // call out our method under test
  const p = plan([logEverything], instances)
  expect(p.routes.map(r => `${r.from}:${r.output.name.split('/').pop()}→${r.to}`)).toEqual(['crm:address-updated→log', 'm:to-jurisdiction→log'])
  const off = plan([{ ...logEverything, enabled: false }], instances)
  expect(off.routes).toEqual([])
  expect(off.status['log-all']).toMatchObject({ enabled: false, viable: true })
})

test('orchestrator: wires and unwires as instances come and go; the chain runs end to end; status follows', async () => {
  // setup: a scope with just crm and tax, orchestrated with the workflow and the logger connection
  const scope = Scopes.create({ onError: e => { throw e } })
  const t = tax(), l = logger()
  const c = await scope.add('crm', crm); await scope.add('tax', t)
  // call out our method under test
  const o = Orchestrators.create(scope, [workflow, logEverything])
  const statuses: boolean[] = []
  o.onStatus(s => statuses.push(s['address-to-tax'].viable))
  expect(o.status()['address-to-tax'].viable).toBe(false)
  expect(scope.routes()).toEqual([])

  // a map instance appears: the workflow becomes viable and is wired
  await scope.add('map', mapper)
  expect(o.status()['address-to-tax'].viable).toBe(true)
  expect(scope.routes().map(r => `${r.from}→${r.to}`)).toEqual(['crm→map', 'map→tax'])

  // a logger appears: everything that gives output is logged too
  await scope.add('log', l)
  await c.publish(addressUpdated, { street: '1 High St', city: 'LONDON', country: 'UK' })
  await flush()
  expect(t.seen).toEqual([{ city: 'london', country: 'UK' }])   // crm → map (action) → its outcome → tax
  expect(l.seen.sort()).toEqual(['crm:address-updated', 'map:to-jurisdiction'])   // the publication and the map's outcome

  // the map goes away: the chain stops, its routes are removed, the logger's stay for what is left
  await scope.remove('map')
  expect(o.status()['address-to-tax'].viable).toBe(false)
  expect(scope.routes().map(r => `${r.from}→${r.to}`)).toEqual(['crm→log'])
  expect(statuses).toContain(true); expect(statuses.at(-1)).toBe(false)

  // switching the logger off removes its routes; stop removes everything the orchestrator made
  o.set([workflow, { ...logEverything, enabled: false }])
  expect(scope.routes()).toEqual([])
  await scope.add('map2', mapper)
  expect(scope.routes().length).toBe(2)
  o.stop()
  expect(scope.routes()).toEqual([])
})

test('intents are plain JSON: they round-trip and plan the same', () => {
  const inst = (name: string, f: { manifest: any }) => ({ name, manifest: f.manifest })
  const instances = [inst('crm', crm), inst('m', mapper), inst('tax', tax())]
  const saved = JSON.parse(JSON.stringify([workflow, logEverything])) as Intent[]
  expect(plan(saved, instances)).toEqual(plan([workflow, logEverything], instances))
})
