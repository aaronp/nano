// A module as `Registry.load` imports it: a default Provider and a `views` export.
import { Implementation, Interface, Provider, provide } from '@pritzlaff/nano-core'

const Thing = Interface.define('acme.Thing', {})
export const thing = Implementation.define('acme/thing', { provides: [Thing], make: async () => [provide(Thing, {})] })
export const views = { 'acme/thing': 'acme-thing' }
export default Provider.define('acme', [thing])
