/**
 * A cluster as deployment data, pure: one runtime per node, `<name>-<i>` (i from 1), which is also the node's id.
 * Each places the shared messaging and clock (the `raft` runtime's, nano.json: placed here, never redefined) and its
 * own node, ledger and seeded random (seed + i), all eager so the nodes start an election by themselves.
 *
 *   await deploy.deploy(clusterDeployment('example', 3, 1))   // runtimes example-1..3, 9 pods
 */
import { Pod, type AppDeployment } from '@pritzlaff/nano-core'
import { seededRandom } from '@pritzlaff/nano-ui'
import { ledger } from './ledger.ts'
import { node } from './node.ts'

/** The `raft` runtime's shared pods (nano.json); named for this example so it imports beside others. */
const MESSAGING = 'raft-messaging', CLOCK = 'raft-clock'

export const nodeIds = (name: string, size: number) => Array.from({ length: size }, (_, i) => `${name}-${i + 1}`)

export function clusterDeployment(name: string, size: 3 | 5, seed: number): { pods: AppDeployment['pods']; runtimes: AppDeployment['runtimes'] } {
  const ids = nodeIds(name, size), pods: AppDeployment['pods'] = {}, runtimes: AppDeployment['runtimes'] = {}
  ids.forEach((id, i) => {
    const raft = `${id}-raft`, store = `${id}-ledger`, random = `${id}-random`
    pods[raft] = Pod.eager(node, { config: { id, peers: ids.filter(x => x !== id) } })
    pods[store] = Pod.eager(ledger)
    pods[random] = Pod.eager(seededRandom, { config: { seed: seed + i + 1 } })
    runtimes[id] = {
      pods: [MESSAGING, CLOCK, raft, store, random],
      subscriptions: [
        ...[MESSAGING, store, CLOCK, random].map(to => ({ kind: 'call' as const, from: raft, to })),
        { kind: 'call', from: MESSAGING, to: raft },
      ],
    }
  })
  return { pods, runtimes }
}
