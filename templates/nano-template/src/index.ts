// The module a host imports: the `acme.template` provider (default export) and its views, by implementation.
import { Coord } from '@pritzlaff/nano-core'
import { picker } from './picker.ts'
import { PickerView } from './picker-view.ts'
import { store } from './store.ts'
import { StoreView } from './store-view.ts'
import { timer } from './timer.ts'
import { TimerView } from './timer-view.ts'

const ns = Coord.namespace('acme.template')

// #region provider
export default ns.provider([timer, picker, store])
// #endregion provider
export const views = { 'acme.template/timer': 'nano-timer', 'acme.template/picker': 'nano-picker', 'acme.template/store': 'nano-store' }

for (const [tag, el] of [['nano-timer', TimerView], ['nano-picker', PickerView], ['nano-store', StoreView]] as const)
  if (!customElements.get(tag)) customElements.define(tag, el)
