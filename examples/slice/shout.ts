import { Coord, Implementation, provide, success } from '@pritzlaff/nano-core'
import { MapIface } from '@pritzlaff/nano-ui'

const ns = Coord.namespace('example.slice')

const shout = Implementation.define(ns.implementationId('shout'), {
  provides: [MapIface],
  make: () => [provide(MapIface, { map: async x => success(`${x}!`) })],
})

export default ns.provider([shout])
export const views = { 'example.slice/shout': 'nano-map' }
