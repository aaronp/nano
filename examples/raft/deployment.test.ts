/** `clusterDeployment`, headless: the runtimes, pods and edges a cluster is, and that it assembles beside nano.json. */
import { describe, expect, test } from 'bun:test'
import { AppDeployment, Registry } from '@pritzlaff/nano-core'
import uiProvider from '@pritzlaff/nano-ui'
import raft from './index.ts'
import { clusterDeployment, timingFor } from './deployment.ts'
import { must } from './test-host.ts'


describe('clusterDeployment', () => {
  test('3 nodes: a runtime each, placing the shared messaging and clock beside its raft, ledger and random', () => {
    const d = clusterDeployment('example', 3, 7)
    expect(Object.keys(d.runtimes)).toEqual(['example-1', 'example-2', 'example-3'])
    expect(d.runtimes['example-2']).toEqual({
      pods: ['raft-messaging', 'raft-clock', 'example-2-raft', 'example-2-ledger', 'example-2-random'],
      subscriptions: [
        { kind: 'call', from: 'example-2-raft', to: 'raft-messaging' },
        { kind: 'call', from: 'example-2-raft', to: 'example-2-ledger' },
        { kind: 'call', from: 'example-2-raft', to: 'raft-clock' },
        { kind: 'call', from: 'example-2-raft', to: 'example-2-random' },
        { kind: 'call', from: 'raft-messaging', to: 'example-2-raft' },
      ],
    })
    // the shared pods are nano.json's, never redefined here
    expect(Object.keys(d.pods)).toHaveLength(9)
    expect(d.pods['raft-messaging']).toBeUndefined()
    expect(d.pods['example-2-raft']).toEqual({ implementation: 'example.raft/node', eager: true, config: { id: 'example-2', peers: ['example-1', 'example-3'] } })
    expect(d.pods['example-2-ledger']).toEqual({ implementation: 'example.raft/ledger', eager: true })
    expect(d.pods['example-2-random']).toEqual({ implementation: 'nano.ui/seeded-random', eager: true, config: { seed: 9 } })
  })

  test('5 nodes: five runtimes, four peers each, seeds seed + i', () => {
    const d = clusterDeployment('big', 5, 1)
    expect(Object.keys(d.runtimes)).toEqual(['big-1', 'big-2', 'big-3', 'big-4', 'big-5'])
    expect(Object.keys(d.pods)).toHaveLength(15)
    expect(d.pods['big-5-raft']!.config).toEqual({ id: 'big-5', peers: ['big-1', 'big-2', 'big-3', 'big-4'] })
    expect([1, 2, 3, 4, 5].map(i => d.pods[`big-${i}-random`]!.config)).toEqual([2, 3, 4, 5, 6].map(seed => ({ seed })))
  })

  test('it assembles against the registry, beside the raft runtime of nano.json', async () => {
    const registry = Registry.create()
    must(registry.add(uiProvider)); must(registry.add(raft))
    const doc = await Bun.file(new URL('./nano.json', import.meta.url)).json() as AppDeployment
    const d = clusterDeployment('example', 3, 1)
    const all = must(AppDeployment.assemble({ pods: { ...doc.pods, ...d.pods }, runtimes: { ...doc.runtimes, ...d.runtimes } }, registry))
    expect(all).toBeDefined()
  })
})

describe('timingFor', () => {
  test('a chosen heartbeat sets elections at 3-6 x; none keeps the fallback', () => {
    expect(timingFor(200)).toEqual({ heartbeat: 200, electionMin: 600, electionMax: 1200 })
    expect(timingFor(undefined, { electionMin: 1, electionMax: 2, heartbeat: 3 })).toEqual({ electionMin: 1, electionMax: 2, heartbeat: 3 })
    expect(timingFor()).toBeUndefined()
  })
})

describe('timing', () => {
  const timing = { electionMin: 3000, electionMax: 6000, heartbeat: 1000 }
  test('a given timing goes into each node\'s config; none leaves it out', () => {
    for (const p of Object.keys(clusterDeployment('x', 3, 1, timing).pods).filter(p => p.endsWith('-raft')))
      expect(clusterDeployment('x', 3, 1, timing).pods[p]!.config).toMatchObject({ timing })
    expect(clusterDeployment('x', 3, 1).pods['x-1-raft']!.config).not.toHaveProperty('timing')
  })
  test('the shipped nano.json is seconds-scale: cluster timing, messaging latency', async () => {
    const doc = await Bun.file(new URL('./nano.json', import.meta.url)).json() as AppDeployment
    expect(doc.pods.cluster!.config).toEqual({ timing })
    expect(doc.pods['raft-messaging']!.config).toEqual({ minMs: 200, maxMs: 600 })
  })
})
