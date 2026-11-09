import { test, expect } from 'bun:test'
import Type from 'typebox'
import { Components, Systems, fail, ok, unwrap, typeHash } from '@composable/sdk'
import { Binders, OrchestratorOps, Orchestrators, checkIntents, plan, type Intent } from '../src'
const links = (s: { snapshot(): { subscriptions: { source: string; listener: string; target?: string }[] } }) => s.snapshot().subscriptions.filter(x => x.target)

const flush = () => new Promise(r => setTimeout(r, 0))
const Address = Type.Object({ street: Type.String(), city: Type.String(), country: Type.String() }, { $id: 'geo.Address' })
const Jurisdiction = Type.Object({ city: Type.String(), country: Type.String() }, { $id: 'geo.Jurisdiction' })

// crm notifies addressUpdated (Address)
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
  const inst = (id: string, f: { manifest: any }) => ({ id, manifest: f.manifest })
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
  const inst = (id: string, f: { manifest: any }) => ({ id, manifest: f.manifest })
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
  const scope = Systems.create({ onError: e => { throw e } })
  const add = async (id: string, f: { create(): any }) => { const c = await f.create(); scope.register(id, c); return c }
  const t = tax(), l = logger()
  const c = await add('crm', crm); await add('tax', t)
  // call out our method under test
  const o = unwrap(Orchestrators.create(scope, [workflow, logEverything]))
  const statuses: boolean[] = []
  o.onStatus(s => statuses.push(s['address-to-tax'].viable))
  expect(o.status()['address-to-tax'].viable).toBe(false)
  expect(links(scope)).toEqual([])

  // a map instance appears: the workflow becomes viable and is wired
  await add('map', mapper)
  expect(o.status()['address-to-tax'].viable).toBe(true)
  expect(links(scope).map(r => `${r.source}→${r.listener}`)).toEqual(['crm→map', 'map→tax'])

  // a logger appears: everything that gives output is logged too
  await add('log', l)
  await c.notify(addressUpdated, { street: '1 High St', city: 'LONDON', country: 'UK' })
  await flush()
  expect(t.seen).toEqual([{ city: 'london', country: 'UK' }])   // crm → map (action) → its outcome → tax
  expect(l.seen.sort()).toEqual(['crm:address-updated', 'map:to-jurisdiction'])   // the publication and the map's outcome

  // the map goes away: the chain stops, its routes are removed, the logger's stay for what is left
  scope.unregister('map')
  expect(o.status()['address-to-tax'].viable).toBe(false)
  expect(links(scope).map(r => `${r.source}→${r.listener}`)).toEqual(['crm→log'])
  expect(statuses).toContain(true); expect(statuses.at(-1)).toBe(false)

  // switching the logger off removes its routes; stop removes everything the orchestrator made
  o.set([workflow, { ...logEverything, enabled: false }])
  expect(links(scope)).toEqual([])
  await add('map2', mapper)
  expect(links(scope).length).toBe(2)
  o.stop()
  expect(links(scope)).toEqual([])
})

test('orchestrator: a change made while it is wiring still triggers a re-plan', async () => {
  const scope = Systems.create({ onError: e => { throw e } })
  for (const [id, f] of [['crm', crm], ['tax', tax()], ['log', logger()], ['m1', mapper], ['m2', mapper]] as const) scope.register(id, f.create())
  // once armed, reacts to the orchestrator's next subscription by removing m2, which makes the workflow unambiguous
  let armed = false
  scope.register('meddler', {
    manifest: { id: { author: 't', id: 'meddler' }, ops: [] },
    onAction: async () => ({ type: 'error', error: { code: 'unknown-action', message: 'none' } }),
    onSystemUpdated: (_s, d) => { if (armed && d.type === 'subscription-opened') { armed = false; scope.unregister('m2') } },
  })
  unwrap(Orchestrators.create(scope, [logEverything, workflow]))
  expect(links(scope).map(r => r.listener)).not.toContain('tax')   // two maps: ambiguous, not wired
  armed = true
  scope.register('crm2', crm.create())   // a new source: the orchestrator subscribes it to the log, and the meddler reacts
  expect(links(scope).map(r => `${r.source}→${r.listener}`)).toContain('m1→tax')
})

test('intents are plain JSON: they round-trip and plan the same', () => {
  const inst = (id: string, f: { manifest: any }) => ({ id, manifest: f.manifest })
  const instances = [inst('crm', crm), inst('m', mapper), inst('tax', tax())]
  const saved = JSON.parse(JSON.stringify([workflow, logEverything])) as Intent[]
  expect(plan(saved, instances)).toEqual(plan([workflow, logEverything], instances))
})

test('a policy under a taken id fails and leaves the first one registered and working', () => {
  const scope = Systems.create()
  const stop = unwrap(Binders.firstProvider(scope))
  expect(Binders.firstProvider(scope).type).toBe('error')
  expect(Orchestrators.create(scope, [], 'binder').type).toBe('error')
  expect(scope.snapshot().instances.map(i => i.id)).toEqual(['binder'])
  stop()
  expect(scope.snapshot().instances).toEqual([])
})

test('the orchestrator can be driven by a link: set-intents', async () => {
  const intentsOut = { name: 't/page/intents', output: Type.Array(Type.Unknown()) }
  const scope = Systems.create(), page = unwrap(scope.register('page', Components.party({ author: 't', id: 'page' }, [intentsOut])))
  for (const [n, f] of [['crm', crm], ['map', mapper], ['tax', tax()]] as const) unwrap(scope.register(n, f.create()))
  Orchestrators.create(scope, [])
  unwrap(scope.subscribe({ source: 'page', op: intentsOut.name, listener: 'orchestrator', target: OrchestratorOps.setIntents.name }))
  await page.notify(intentsOut, [workflow]); await flush()
  expect(scope.snapshot().subscriptions.filter(s => s.listener !== 'orchestrator').map(s => `${s.source}→${s.listener}`)).toEqual(['crm→map', 'map→tax'])
  await page.notify(intentsOut, [{ kind: 'workflow', id: 'bad' }, null]); await flush() // malformed: refused, previous intents stay
  expect(scope.snapshot().subscriptions.filter(s => s.listener !== 'orchestrator').length).toBe(2)
  expect((await page.call('orchestrator', OrchestratorOps.setIntents, [null])).type).toBe('error')
  await page.notify(intentsOut, []); await flush()
  expect(scope.snapshot().subscriptions.filter(s => s.listener !== 'orchestrator')).toEqual([])
})

test('malformed intents are refused with no instances present, and the previous intents stay', () => {
  const scope = Systems.create()
  const o = unwrap(Orchestrators.create(scope, [workflow]))
  const bad = [
    { kind: 'connection', id: 'c', from: { output: { by: 'outputs' } }, to: { select: { by: 'any' }, op: 'x' } },
    { kind: 'connection', id: 'c', from: { select: { by: 'bogus' }, output: { by: 'outputs' } }, to: { select: { by: 'any' }, op: 'x' } },
    { kind: 'workflow', id: 'w', steps: [{ op: 'x' }] },
  ]
  for (const b of bad) expect(o.set([b as never]).type).toBe('error')
  for (const [n, f] of [['crm', crm], ['map', mapper], ['tax', tax()]] as const) unwrap(scope.register(n, f.create()))
  expect(scope.snapshot().subscriptions.filter(s => s.listener !== 'orchestrator').map(s => `${s.source}→${s.listener}`)).toEqual(['crm→map', 'map→tax'])
})

test('create checks its initial intents', () => {
  expect(Orchestrators.create(Systems.create(), [{ kind: 'workflow', id: 'w' } as never]).type).toBe('error')
})

test('checkIntents refuses an intent id used twice', () => {
  const w = { kind: 'workflow', id: 'w', steps: [] }
  expect(checkIntents([w, { ...w }])).toEqual(fail('validation', 'intents[1].id w is used twice'))
  expect(checkIntents([w, { ...w, id: 'v' }]).type).toBe('success')
})
