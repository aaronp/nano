import { implementation, provide, provider, success } from '@pritzlaff/nano'
import { MapIface } from '../../src/index.ts'

export default provider('example.fx', [implementation('example.fx/echo', { provides: [MapIface], make: () => [provide(MapIface, { map: async x => success(x) })] })])
export const views = { 'example.fx/echo': 'nano-map' }
