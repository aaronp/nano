import { expect, test } from 'bun:test'
import type { Snapshot } from '@pritzlaff/nano-core'
import { isInfrastructure, viewIds } from '../src/infrastructure'

test('viewIds picks instances owned by a view', () => {
  const s = { instances: [{ id: 'v1', owner: { kind: 'view', name: 'x' } }, { id: 'r1' }, { id: 'o', owner: { kind: 'app', name: 'y' } }] } as unknown as Snapshot
  expect([...viewIds(s)]).toEqual(['v1'])
})

test('isInfrastructure: the host’s own, and a view’s', () => {
  const views = new Set(['v1'])
  for (const id of ['registry', 'application', 'app', 'alerts', 'ws-controls-a', 'v1']) expect(isInfrastructure(id, views)).toBe(true)
  for (const id of ['profile', 'ex-range', 'r1']) expect(isInfrastructure(id, views)).toBe(false)
})
