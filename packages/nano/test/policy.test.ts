import { expect, test } from 'bun:test'
import { Policies } from '../src/policy.ts'

test('allowAll approves anything', () => {
  expect(Policies.allowAll().isAllowed('a#1', 'b#1', { x: 1 })).toEqual({ approved: true })
})
