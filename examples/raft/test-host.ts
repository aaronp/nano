/**
 * Test-only: a `HostDeploy` holding the app (the workspace's own lives in ui-workspace, which examples don't import),
 * and the `raft` runtime of nano.json opened with it, as importing it into a host does: `deploy` placed beside the
 * cluster and wired to it, the deployment policy `allowAll`.
 *
 *   const app = await openRaft()
 *   await app.call('raft', 'cluster').create({ name: 'example', size: 3, seed: 1 })
 */
import { Application, AppDeployment, Coord, DeploymentPolicies, Implementation, Pod, Registry, failure, provide, success, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider, { HostDeploy } from '@pritzlaff/nano-ui'
import raft from './index.ts'

const ns = Coord.namespace('example.raft.test')
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

/** Adds pods and runtimes (a name already there is invalid-input); removes runtimes and the pods placed nowhere else. */
function testDeploy(app: () => Application) {
  return Implementation.define(ns.implementationId('deploy'), {
    provides: [HostDeploy],
    make: ctx => {
      const apply = async (next: AppDeployment): Promise<NanoResult<null>> => {
        const r = await app().apply(next, { caller: ctx.self })
        return r.ok ? success(null) : r
      }
      return [provide(HostDeploy, {
        deploy: async ({ pods, runtimes }) => {
          const d = app().deployment()
          const taken = [...Object.keys(pods).filter(p => p in d.pods), ...Object.keys(runtimes).filter(r => r in d.runtimes)]
          if (taken.length) return failure('invalid-input', `already in the deployment: ${taken.join(', ')}`)
          return apply({ ...d, pods: { ...d.pods, ...pods }, runtimes: { ...d.runtimes, ...runtimes } } as AppDeployment)
        },
        undeploy: async ({ runtimes }) => {
          const d = structuredClone(app().deployment())
          for (const r of runtimes) delete d.runtimes[r]
          const placed = new Set(Object.values(d.runtimes).flatMap(r => r.pods))
          for (const p of Object.keys(d.pods)) if (!placed.has(p)) delete d.pods[p]
          return apply(d)
        },
      })]
    },
  })
}

/** The `raft` runtime with the test host's `deploy`; a fresh registry and app each time. */
export async function openRaft(): Promise<Application> {
  let app: Application | undefined
  const deploy = testDeploy(() => app!), registry = Registry.create()
  for (const p of [uiProvider, raft, ns.provider([deploy])]) must(registry.add(p))
  const doc = await Bun.file(new URL('./nano.json', import.meta.url)).json() as AppDeployment
  const main = doc.runtimes.raft!
  const d = { pods: { ...doc.pods, deploy: Pod.lazy(deploy) }, runtimes: { raft: {
    ...main, pods: [...main.pods, 'deploy'], subscriptions: [...main.subscriptions, { kind: 'call' as const, from: 'cluster', to: 'deploy' }] } } }
  app = must(await Application.create(must(AppDeployment.assemble(d, registry)), { deploymentPolicy: DeploymentPolicies.allowAll() }))
  return app
}
