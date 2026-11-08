import { test, expect } from 'bun:test'
import Type from 'typebox'
import { Components, ok, typeHash } from '@composable/sdk'
import { plan } from '@composable/connections'
import { board, emptyDoc, look, move, palette, partners, pin, place, take, toggle, workflows, stepFor, type Doc } from '../src/model'

const Address = Type.Object({ street: Type.String(), city: Type.String(), country: Type.String() }, { $id: 'geo.Address' })
const Jurisdiction = Type.Object({ city: Type.String(), country: Type.String() }, { $id: 'geo.Jurisdiction' })
const Crm = Components.declare({ author: 't', id: 'crm' })
Crm.op('address-updated', 'An address changed', { output: Address })
const crm = Crm.define({ state: () => null })
const M = Components.declare({ author: 't', id: 'map' })
const toJ = M.op('to-jurisdiction', 'Address → Jurisdiction', { input: Address, output: Jurisdiction })
const map = M.define({ state: () => null, handlers: [[toJ, ({ city, country }) => ok({ city, country })]] })
const T = Components.declare({ author: 't', id: 'tax' })
const rate = T.op('rate-for', 'Set the jurisdiction', { input: Jurisdiction })
const tax = T.define({ state: () => null, handlers: [[rate, () => {}]] })
const L = Components.declare({ author: 't', id: 'log' })
const log = L.op('log', 'anything', { input: Type.Unknown() })
const logger = L.define({ state: () => null, handlers: [[log, () => {}]] })
const instances = [
  { name: 'crm', manifest: crm.manifest }, { name: 'map', manifest: map.manifest },
  { name: 'tax', manifest: tax.manifest }, { name: 'log', manifest: logger.manifest },
]

test('palette: components with their instances and pieces; types by SAID with readable names', () => {
  // call out our method under test
  const p = palette([...instances, { name: 'map2', manifest: map.manifest }])
  expect(p.map(e => [e.key, e.instances])).toEqual([['t/crm', ['crm']], ['t/log', ['log']], ['t/map', ['map', 'map2']], ['t/tax', ['tax']]])
  const mapPiece = p[2].pieces[0]
  expect(mapPiece).toMatchObject({ label: 'to-jurisdiction', role: 'action', input: { name: 'Address', hash: typeHash(Address), any: false }, output: { name: 'Jurisdiction' } })
  expect(p[1].pieces[0].input).toMatchObject({ name: 'any', any: true })
})

test('partners: what a picked-up piece could join (exact SAID, or an input that takes anything)', () => {
  const p = palette(instances)
  const mapPiece = p.find(e => e.key === 't/map')!.pieces[0]
  // call out our method under test
  expect(partners(p, mapPiece)).toEqual([
    { key: 't/crm', op: 't/crm/address-updated', side: 'before' },
    { key: 't/log', op: 't/log/log', side: 'after' },
    { key: 't/tax', op: 't/tax/rate-for', side: 'after' },
  ])
})

test('edits: place, join, merge and split keep the board and the workflow intents the same thing', () => {
  // setup: one piece per component, by component
  const p = palette(instances), piece = (key: string) => { const e = p.find(x => x.key === key)!; return stepFor(e, e.pieces[0]) }
  let doc: Doc = emptyDoc()
  // call out our methods under test: crm at (0,0), tax at (2,0) are separate; the map between merges them
  doc = place(doc, piece('t/crm'), { c: 0, r: 0 }, 'w1')
  doc = place(doc, piece('t/tax'), { c: 2, r: 0 }, 'w2')
  expect(workflows(doc).map(w => w.steps.length)).toEqual([1, 1])
  doc = place(doc, piece('t/map'), { c: 1, r: 0 }, 'w3')
  expect(workflows(doc)).toEqual([{ kind: 'workflow', id: 'w1', steps: [piece('t/crm'), piece('t/map'), piece('t/tax')] }])
  expect(board(doc).map(b => `${b.cell.c},${b.cell.r}`)).toEqual(['0,0', '1,0', '2,0'])
  // the chain is viable with these instances
  expect(plan(doc.intents, instances).status.w1).toMatchObject({ viable: true, routes: 2 })

  // taking the middle out splits it in two; moving it back joins it again
  const split = take(doc, 'w1', 1, 'w4')
  expect(workflows(split).map(w => [w.id, w.steps.length])).toEqual([['w1', 1], ['w4', 1]])
  expect(board(split).map(b => `${b.workflow}@${b.cell.c}`)).toEqual(['w1@0', 'w4@2'])
  expect(move(doc, 'w1', 1, { c: 1, r: 1 }, ['w4', 'w5']).layout.w5).toEqual({ c: 1, r: 1 })

  // prepend: a piece dropped just before a workflow's start becomes its first step and moves its start
  const pre = place(take(doc, 'w1', 0, 'x'), piece('t/crm'), { c: 0, r: 0 }, 'unused')
  expect(workflows(pre)[0].steps[0]).toEqual(piece('t/crm'))
  expect(pre.layout.w1 ?? pre.layout.x).toEqual({ c: 0, r: 0 })
})

test('edits: pin a piece to one instance; switch a workflow off; the document is plain JSON', () => {
  const p = palette([...instances, { name: 'map2', manifest: map.manifest }]), e = (k: string) => p.find(x => x.key === k)!
  let doc = place(place(place(emptyDoc(), stepFor(e('t/crm'), e('t/crm').pieces[0]), { c: 0, r: 0 }, 'w'),
    stepFor(e('t/map'), e('t/map').pieces[0]), { c: 1, r: 0 }, 'x'), stepFor(e('t/tax'), e('t/tax').pieces[0]), { c: 2, r: 0 }, 'y')
  const all = [...instances, { name: 'map2', manifest: map.manifest }]
  expect(plan(doc.intents, all).status.w.problems).toEqual([{ kind: 'ambiguous', at: 'step 1', instances: ['map', 'map2'] }])
  // call out our method under test: pin the map step to one instance
  doc = pin(doc, 'w', 1, { by: 'name', name: 'map2' })
  expect(plan(doc.intents, all).status.w.viable).toBe(true)
  doc = toggle(doc, 'w', false)
  expect(plan(doc.intents, all).routes).toEqual([])
  expect(JSON.parse(JSON.stringify(doc))).toEqual(doc)
})

test('look: deterministic per SAID, different for different types, plain for "any"', () => {
  const a = { hash: typeHash(Address), name: 'Address', any: false }, j = { hash: typeHash(Jurisdiction), name: 'Jurisdiction', any: false }
  expect(look(a)).toEqual(look({ ...a }))
  expect(look(a)).not.toEqual(look(j))
  expect(look({ hash: '', name: 'any', any: true }).head).toBe(0)
})

test('typeName shows constraints, so types that differ only by them read differently', async () => {
  const { typeName } = await import('../src/model')
  expect(typeName(Type.Number())).toBe('number')
  expect(typeName(Type.Number({ minimum: 0, maximum: 100 }))).toBe('number 0..100')
  expect(typeName(Type.String({ pattern: '^a' }))).toBe('string (pattern)')
  expect(typeName(Type.Object({ a: Type.String() }))).toBe('{ a }')
})
