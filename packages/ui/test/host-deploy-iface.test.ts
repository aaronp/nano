// HostDeploy's schemas: deploy takes pods and runtimes (checked strictly when applied), undeploy runtime ids.
import { expect, test } from 'bun:test'
import { Value } from 'typebox/value'
import { HostDeploy } from '../src/index.ts'

const { deploy, undeploy } = HostDeploy.ops

test('deploy takes pods and runtimes, and gives nothing', () => {
  expect(Value.Check(deploy.input!, { pods: { a: { implementation: 'x/y', eager: false } }, runtimes: { r: { pods: ['a'], subscriptions: [] } } })).toBe(true)
  expect(Value.Check(deploy.input!, { pods: {} })).toBe(false)
  expect(Value.Check(deploy.input!, { runtimes: {} })).toBe(false)
  expect(Value.Check(deploy.output!, null)).toBe(true)
})

test('undeploy takes runtime ids, and gives nothing', () => {
  expect(Value.Check(undeploy.input!, { runtimes: ['example-1'] })).toBe(true)
  expect(Value.Check(undeploy.input!, { runtimes: 'example-1' })).toBe(false)
  expect(Value.Check(undeploy.output!, null)).toBe(true)
})
