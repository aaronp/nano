import { test, expect } from 'bun:test'
import Type from 'typebox'
import Value from 'typebox/value'
import { defineManifest, ComponentId, Instance, Manifest, OpDef } from '../src'

test('manifest round-trips through structuredClone and still validates payloads', () => {
  const m = defineManifest({ id: { author: 'acme', id: 'x' }, ops: [{ name: 'fired', output: Type.Object({ text: Type.String() }) }] })
  expect(Value.Check(Manifest, m)).toBe(true)
  const cloned = structuredClone(JSON.parse(JSON.stringify(m)))
  expect(Value.Check(cloned.ops[0].output, { text: 'a' })).toBe(true)
  expect(Value.Check(cloned.ops[0].output, { text: 1 })).toBe(false)
})
test('every top-level schema has title and description', () => {
  for (const s of [ComponentId, Manifest, Instance, OpDef] as { title?: string; description?: string }[])
    expect(s.title && s.description).toBeTruthy()
})
