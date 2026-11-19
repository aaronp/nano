// summary: the one line the approval dialog shows for a deployment change.
import { expect, test } from 'bun:test'
import { Pod, type AppDeployment } from '@pritzlaff/nano-core'
import { log } from '@pritzlaff/nano-ui'
import { addTo } from '../src/host-deploy.ts'
import { summary } from '../src/deploy-summary.ts'

const lazy = Pod.lazy(log)
const node = (i: number) => ({ pods: ['messaging', `example-${i}-raft`], subscriptions: [] })
const three = {
  pods: Object.fromEntries([1, 2, 3].map(i => [`example-${i}-raft`, lazy])),
  runtimes: Object.fromEntries([1, 2, 3].map(i => [`example-${i}`, node(i)])),
}

test('summary names the runtimes and pod count', () => {
  const before: AppDeployment = { pods: { messaging: lazy }, runtimes: { raft: { pods: ['messaging'], subscriptions: [] } } }
  const after = addTo(before, three)
  if (!after.ok) throw new Error(after.fail.reason)
  expect(summary(before, after.value)).toBe('Create runtimes example-1..3 (3 pods); places messaging')
  expect(summary(after.value, before)).toBe('Remove runtimes example-1..3; drops example-1..3-raft')
  const one = addTo(before, { pods: { solo: lazy }, runtimes: { solo: { pods: ['solo'], subscriptions: [] } } })
  if (!one.ok) throw new Error(one.fail.reason)
  expect(summary(before, one.value)).toBe('Create runtime solo (1 pod)')
})

test('summary names the existing pods a new runtime places and each subscription reaching one', () => {
  const before: AppDeployment = { pods: { vault: lazy }, runtimes: { safe: { pods: ['vault'], subscriptions: [] } } }
  const after = addTo(before, { pods: { n1: lazy }, runtimes: { x: { pods: ['n1', 'vault'], subscriptions: [{ kind: 'call', from: 'n1', to: 'vault' }] } } })
  if (!after.ok) throw new Error(after.fail.reason)
  expect(summary(before, after.value)).toBe('Create runtime x (1 pod); places vault; n1 → vault')
})

test('summary reads a Raft-shaped cluster compactly', () => {
  const before: AppDeployment = { pods: { messaging: lazy, clock: lazy }, runtimes: { raft: { pods: ['messaging', 'clock'], subscriptions: [] } } }
  const pods: AppDeployment['pods'] = {}, runtimes: AppDeployment['runtimes'] = {}
  for (const i of [1, 2, 3]) {
    const raft = `example-${i}-raft`, ledger = `example-${i}-ledger`, random = `example-${i}-random`
    Object.assign(pods, { [raft]: lazy, [ledger]: lazy, [random]: lazy })
    runtimes[`example-${i}`] = { pods: ['messaging', 'clock', raft, ledger, random], subscriptions: [
      { kind: 'call', from: raft, to: 'messaging' }, { kind: 'call', from: raft, to: ledger }, { kind: 'call', from: raft, to: 'clock' },
      { kind: 'call', from: raft, to: random }, { kind: 'call', from: 'messaging', to: raft }] }
  }
  const after = addTo(before, { pods, runtimes })
  if (!after.ok) throw new Error(after.fail.reason)
  expect(summary(before, after.value)).toBe('Create runtimes example-1..3 (9 pods); places messaging, clock; example-1..3-raft → messaging, example-1..3-raft → clock, messaging → example-1..3-raft')
})
