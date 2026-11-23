/** A real provider module for `Registry.load`: one implementation that answers 'pong'. */
import { Type } from 'typebox'
import { Implementation, Interface, Op, Provider } from '../../src/index.ts'

const Ping = Interface.define('acme.Ping', { ping: Op.action(Type.Null(), Type.String()) })
export default Provider.define('acme', [Implementation.define('acme/ping', { provides: [Ping], make: () => ({ async ping() { return 'pong' } }) })])
