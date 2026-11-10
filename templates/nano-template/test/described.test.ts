// Every op of every component here has a description, and no schema is an Unknown nobody explained (a described
// Type.Unknown is a deliberate "anything"). Keep this test: it is how a new component proves it is documented.
import { expect, test } from 'bun:test'
import { Ops, type Op } from '@pritzlaff/nano-core'
import { catalog } from '../src'

const undescribedAny = (s: unknown) => !!s && typeof s === 'object' && !['type', 'anyOf', 'oneOf', 'allOf', '$ref', 'const', 'enum', 'not', 'description'].some(k => k in s)
const problems = (op: Op) => [
  ...(op.description ? [] : ['no description']),
  ...(['input', 'output'] as const).filter(k => op[k] && undescribedAny(op[k])).map(k => `undescribed Unknown ${k}`),
].map(p => `${Ops.key(op)}: ${p}`)

test('every op of every component is described', () => {
  expect(Object.values(catalog).flatMap(e => [...e.component.actions.values()].map(a => problems(a.op)).flat())).toEqual([])
})

test('every component says what it is for', () => {
  expect(Object.entries(catalog).filter(([, e]) => !e.component.description).map(([k]) => k)).toEqual([])
})
