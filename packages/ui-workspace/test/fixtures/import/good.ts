import { Coord, Implementation, provide, success } from '@pritzlaff/nano-core'
import { MapIface } from '@pritzlaff/nano-ui'

const ns = Coord.namespace('example.fx')

export default ns.provider([Implementation.define(ns.implementationId('echo'), { provides: [MapIface], make: () => [provide(MapIface, { map: async x => success(x) })] })])
export const views = { 'example.fx/echo': 'nano-map' }
