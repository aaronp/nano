import { test, expect } from 'bun:test'
import Type from 'typebox'
import Value from 'typebox/value'
import { defineManifest, allows, sameInstance, ComponentId, Manifest, Instance, InstanceRef, Invocation, Capabilities } from '../src'

test('manifest round-trips through structuredClone and still validates payloads', () => {
  const m = defineManifest({ id: { author: 'acme', id: 'x' }, version: '0.1.0',
    emits: [{ name: 'fired', schema: Type.Object({ text: Type.String() }) }], consumes: [] })
  expect(Value.Check(Manifest, m)).toBe(true)
  const cloned = structuredClone(JSON.parse(JSON.stringify(m)))
  expect(Value.Check(cloned.emits[0].schema, { text: 'a' })).toBe(true)
  expect(Value.Check(cloned.emits[0].schema, { text: 1 })).toBe(false)
})
test('allows: all / allow / deny', () => {
  const eq = (a: number, b: number) => a === b
  expect(allows({ type: 'all' }, 1, eq)).toBe(true)
  expect(allows({ type: 'allow', values: [1] }, 2, eq)).toBe(false)
  expect(allows({ type: 'deny', values: [1] }, 1, eq)).toBe(false)
})
test('sameInstance compares namespace paths structurally', () => {
  expect(sameInstance({ namespace: ['root'], instance: 'a' }, { namespace: ['root'], instance: 'a' })).toBe(true)
  expect(sameInstance({ namespace: ['root','h'], instance: 'a' }, { namespace: ['root'], instance: 'a' })).toBe(false)
})
test('every top-level schema has title and description', () => {
  for (const s of [ComponentId, Manifest, Instance, InstanceRef, Invocation, Capabilities] as { title?: string; description?: string }[])
    expect(s.title && s.description).toBeTruthy()
})
