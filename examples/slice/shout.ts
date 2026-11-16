import { Implementation, provide, Provider, success } from '@pritzlaff/nano-core'
import { MapIface } from '@pritzlaff/nano-ui'

const shout = Implementation.define('example.slice/shout', {
  provides: [MapIface],
  make: () => [provide(MapIface, { map: async x => success(`${x}!`) })],
})

export default Provider.define('example.slice', [shout])
export const views = { 'example.slice/shout': 'nano-map' }
