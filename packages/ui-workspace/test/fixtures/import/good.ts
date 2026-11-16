import { Implementation, provide, Provider, success } from '@pritzlaff/nano-core'
import { MapIface } from '@pritzlaff/nano-ui'

export default Provider.define('example.fx', [Implementation.define('example.fx/echo', { provides: [MapIface], make: () => [provide(MapIface, { map: async x => success(x) })] })])
export const views = { 'example.fx/echo': 'nano-map' }
