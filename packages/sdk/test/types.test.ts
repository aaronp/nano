import { test, expect } from 'bun:test'
import Type from 'typebox'
import Value from 'typebox/value'
import { defineManifest, ComponentId, Instance, Manifest } from '../src'

test('manifest round-trips through structuredClone and still validates payloads', () => {
  const m = defineManifest({ id: { author: 'acme', id: 'x' }, version: '0.1.0',
    emits: [{ name: 'fired', schema: Type.Object({ text: Type.String() }) }], consumes: [] })
  expect(Value.Check(Manifest, m)).toBe(true)
  const cloned = structuredClone(JSON.parse(JSON.stringify(m)))
  expect(Value.Check(cloned.emits[0].schema, { text: 'a' })).toBe(true)
  expect(Value.Check(cloned.emits[0].schema, { text: 1 })).toBe(false)
})
test('every top-level schema has title and description', () => {
  for (const s of [ComponentId, Manifest, Instance] as { title?: string; description?: string }[])
    expect(s.title && s.description).toBeTruthy()
})
