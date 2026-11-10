// The guard: every op this host offers (each catalog kind, the platform and the registry) has a description, and no
// schema is an Unknown nobody explained. A described Type.Unknown is a deliberate "anything".
import { expect, test } from 'bun:test'
import { Ops, Registries, RegistryOps, Runtimes, type Op } from '@pritzlaff/nano-core'
import { catalog as bundle } from '@composable/bundle'
import { catalog as editor } from '@composable/editor'
import { platform } from '@composable/platform'

const catalog = { ...bundle, ...editor }
const undescribedAny = (s: unknown) => !!s && typeof s === 'object' && !['type', 'anyOf', 'oneOf', 'allOf', '$ref', 'const', 'enum', 'not', 'description'].some(k => k in s)
const problems = (op: Op) => [
  ...(op.description ? [] : ['no description']),
  ...(['input', 'output'] as const).filter(k => op[k] && undescribedAny(op[k])).map(k => `undescribed Unknown ${k}`),
].map(p => `${Ops.key(op)}: ${p}`)

test('every op of every catalog component, the platform and the registry is described', () => {
  const host = Runtimes.create(Registries.create('host'))
  const ops = [
    ...Object.values(catalog).flatMap(e => [...e.component.actions.values()].map(a => a.op)),
    ...[...platform(host, catalog).actions.values()].map(a => a.op),
    ...(Object.values(RegistryOps).filter(o => 'ns' in o) as Op[]), ...Object.values(RegistryOps.deltas),
  ]
  expect(ops.flatMap(problems)).toEqual([])
})

test('every catalog component says what it is for', () => {
  expect(Object.entries(catalog).filter(([, e]) => !e.component.description).map(([k]) => k)).toEqual([])
})
