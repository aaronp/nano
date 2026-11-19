// A management pod: `map(addition)` deploys it through its HostDeploy dependency, answering that call's result.
import { Coord, Implementation, provide } from '@pritzlaff/nano-core'
import { HostDeploy, MapIface } from '@pritzlaff/nano-ui'

const ns = Coord.namespace('test.deploy')

export default ns.provider([Implementation.define(ns.implementationId('cluster'), {
  provides: [MapIface], dependencies: { deploy: HostDeploy },
  make: ctx => [provide(MapIface, { map: async add => { const d = ctx.one(HostDeploy); return d.ok ? d.value.call.deploy(add as never) : d } })],
})])
