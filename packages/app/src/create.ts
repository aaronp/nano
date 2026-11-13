// createApplication: the host runtime with its app-bar gateway and the Application, from catalogs.
import { Components, Registries, Runtimes, err, isOk, ok, type Owner, type Result, type Runtime, type Selectors } from '@pritzlaff/nano-core'
import type { AppCatalog } from './catalog'
import { application, runtimeOf } from './application'
import { AppGateway } from './gateway'

export type DeployFn = (system: Runtime, id: string, kind: string, mode: string | undefined, owner: Owner, outward?: Selectors) => Result<void>
export type PlacementsOf = (layout: unknown) => { panel: string; instance: string }[]

/** Host only: makes the kind's component in the system, owned by `owner`. */
const hostDeploy = (catalog: AppCatalog): DeployFn => (system, id, kind, mode, owner) => {
  if (mode && mode !== 'host') return err(`${kind} can't be deployed as ${mode}: this application deploys in the host only`)
  const e = catalog[kind]
  if (!e) return err(`no component kind ${kind}`)
  const added = system.registry.add(id, Components.instantiate(e.component), owner)
  return isOk(added) ? ok(undefined) : added
}

/** Creates the host runtime (registry `registryId`, default `host`) with `app` (the AppGateway) and `application`.
 * `catalog` is the catalogs merged into one object: later imports add kinds to it and the application reads it at call time. */
export function createApplication(opts: { catalogs: AppCatalog[]; deploy?: DeployFn; placementsOf?: PlacementsOf; gateways?: readonly string[]; locked?: (id: string) => boolean; registryId?: string }): { host: Runtime; catalog: AppCatalog } {
  const catalog: AppCatalog = Object.assign({}, ...opts.catalogs)
  // peers: the other systems, found late through the application added below
  const host: Runtime = Runtimes.create(Registries.create(opts.registryId ?? 'host'), undefined, { peers: id => runtimeOf(host.registry, id) })
  host.registry.add('app', Components.instantiate(AppGateway), { kind: 'app', name: 'application' })
  host.registry.add('application', Components.instantiate(application(host, catalog, {
    gateways: opts.gateways ?? ['app'], deploy: opts.deploy ?? hostDeploy(catalog),
    ...(opts.locked && { locked: opts.locked }), ...(opts.placementsOf && { placementsOf: opts.placementsOf }),
  })), { kind: 'app', name: 'application' })
  return { host, catalog }
}
