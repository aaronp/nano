import { implementation, provide, provider, success } from '@pritzlaff/nano-core'
import { MapIface } from '@pritzlaff/nano-ui'

export default provider('example.fx', [implementation('example.fx/echo', { provides: [MapIface], make: () => [provide(MapIface, { map: async x => success(x) })] })])
export const views = { 'example.fx/echo': 'nano-map' }
