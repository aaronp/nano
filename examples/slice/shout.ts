import { implementation, provide, provider, success } from '@pritzlaff/nano-core'
import { MapIface } from '@pritzlaff/nano-ui'

const shout = implementation('example.slice/shout', {
  provides: [MapIface],
  make: () => [provide(MapIface, { map: async x => success(`${x}!`) })],
})

export default provider('example.slice', [shout])
export const views = { 'example.slice/shout': 'nano-map' }
