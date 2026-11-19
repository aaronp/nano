/**
 * `example.raft/cluster`: the management pod. `create` deploys a cluster's runtimes through the host's `HostDeploy`
 * (the host's deployment policy decides, so the user may be asked); `remove` undeploys them. It lists the clusters
 * it has created (in memory: a restart forgets them, the runtimes stay). A name it doesn't know (after a restart or a
 * reload) is tried as a cluster of 5, then of 3: `undeploy` refuses a missing runtime whole, asking nothing.
 */
import { Coord, Implementation, failure, provide, success, type NanoResult } from '@pritzlaff/nano-core'
import { HostDeploy } from '@pritzlaff/nano-ui'
import { Cluster } from './interfaces.ts'
import { clusterDeployment, nodeIds } from './deployment.ts'

const ns = Coord.namespace('example.raft')

export const cluster = Implementation.define(ns.implementationId('cluster'), {
  provides: [Cluster],
  dependencies: { deploy: HostDeploy },
  make: ctx => {
    const sizes = new Map<string, number>()
    return [provide(Cluster, {
      create: async ({ name, size, seed }) => {
        const host = ctx.one(HostDeploy)
        if (!host.ok) return host
        const r = await host.value.call.deploy(clusterDeployment(name, size, seed))
        if (r.ok) sizes.set(name, size)
        return r
      },
      remove: async ({ name }) => {
        const host = ctx.one(HostDeploy)
        if (!host.ok) return host
        let r: NanoResult<null> = failure('not-found', `no cluster ${name}`)
        for (const size of sizes.has(name) ? [sizes.get(name)!] : [5, 3]) {
          r = await host.value.call.undeploy({ runtimes: nodeIds(name, size) })
          if (r.ok || r.fail.type !== 'not-found') break
        }
        if (r.ok) sizes.delete(name)
        return r
      },
      list: async () => success([...sizes.keys()]),
    })]
  },
})
