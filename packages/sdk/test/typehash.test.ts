import { test, expect } from 'bun:test'
import Type from 'typebox'
import { canonicalType, digest, digestFor, typeHash, typeIndex } from '../src'

test('digest is kerits/keripy compatible (Blake3-256, CESR "E")', () => {
  // call our method under test on keripy's Diger(ser=verfer.qb64b) input
  const d = digest(new TextEncoder().encode('DI7RaWkGRhHCXnjysdVQXeEQ4euvcyCAh1kH8rEpHEEs'))
  // same digest keripy 1.3.4 produces (kerits core digest.test.ts)
  expect(d).toBe('EGbgzK09e_katitXWHkL_iWViYKaA1WAyYQHFBdTTHfG')
})

test('structure decides an unnamed type: annotations, key order and set order do not', () => {
  // setup: the same structure written three ways
  const a = Type.Object({ x: Type.Number(), y: Type.String() })
  const b = Type.Object({ y: Type.String({ description: 'why' }), x: Type.Number() }, { title: 'Point' })
  const c = Type.Union([Type.String(), Type.Number()]), d = Type.Union([Type.Number(), Type.String()])
  // call our method under test
  expect(typeHash(a)).toBe(typeHash(b))
  expect(typeHash(c)).toBe(typeHash(d))
  // a real difference changes the hash
  expect(typeHash(a)).not.toBe(typeHash(Type.Object({ x: Type.Number(), y: Type.Number() })))
  expect(typeHash(Type.String())).not.toBe(typeHash(Type.String({ minLength: 1 })))
})

test('a name is part of identity: same fields, different names differ; a named wrapper is a brand', () => {
  const fields = { city: Type.String(), country: Type.String() }
  const jurisdiction = Type.Object(fields, { $id: 'geo.Jurisdiction' })
  const place = Type.Object(fields, { $id: 'geo.Place' })
  expect(typeHash(jurisdiction)).not.toBe(typeHash(place))
  expect(typeHash(jurisdiction)).not.toBe(typeHash(Type.Object(fields)))
  // a brand of string only matches itself
  expect(typeHash(Type.String({ $id: 'acme.Email' }))).not.toBe(typeHash(Type.String()))
  expect(typeHash(Type.String({ $id: 'acme.Email' }))).toBe(typeHash(Type.String({ $id: 'acme.Email' })))
})

test('a named type inside another appears by reference; changing it changes the outer hash', () => {
  // setup: Customer holds an Address
  const address = Type.Object({ street: Type.String(), city: Type.String() }, { $id: 'geo.Address' })
  const customer = Type.Object({ name: Type.String(), address }, { $id: 'crm.Customer' })
  // call our method under test
  const form = canonicalType(customer) as { properties: { address: unknown } }
  // the inner type is just its hash, so the outer type stands alone
  expect(form.properties.address).toEqual({ $ref: typeHash(address) })
  const address2 = Type.Object({ street: Type.String(), city: Type.String(), zip: Type.String() }, { $id: 'geo.Address' })
  expect(typeHash(Type.Object({ name: Type.String(), address: address2 }, { $id: 'crm.Customer' }))).not.toBe(typeHash(customer))
  expect(typeHash(customer)).toBe(digestFor(form))
})

test('typeIndex: which ops take and give each type', () => {
  const address = Type.Object({ city: Type.String(), country: Type.String(), street: Type.String() }, { $id: 'geo.Address' })
  const jurisdiction = Type.Object({ city: Type.String(), country: Type.String() }, { $id: 'geo.Jurisdiction' })
  const instances = [
    { name: 'crm', manifest: { ops: [{ name: 'address-updated', output: address }] } },
    { name: 'tax', manifest: { ops: [{ name: 'rate-for', input: jurisdiction, output: Type.Number() }] } },
  ]
  // call our method under test
  const { takes, gives } = typeIndex(instances)
  expect(gives.get(typeHash(address))).toEqual([{ instance: 'crm', op: 'address-updated' }])
  expect(takes.get(typeHash(jurisdiction))).toEqual([{ instance: 'tax', op: 'rate-for' }])
  expect(takes.get(typeHash(address))).toBeUndefined()   // nothing takes an Address as-is: a map is needed
})
