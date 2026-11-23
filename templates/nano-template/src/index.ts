// The module a host imports: the `acme.template` provider (default export) and its views, by implementation.
import { Coord } from '@pritzlaff/nano-core'
import { calculator } from './calculator.ts'
import { CalculatorView } from './calculator-view.ts'
import { history } from './history.ts'

const ns = Coord.namespace('acme.template')

// #region provider
export default ns.provider([calculator, history])
// #endregion provider
export const views = { 'acme.template/calculator': 'nano-calculator' }

if (!customElements.get('nano-calculator')) customElements.define('nano-calculator', CalculatorView)
