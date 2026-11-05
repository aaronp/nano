import Type from 'typebox'
import { Components } from '@composable/sdk'

const C = Components.declare({ author: 'composable', id: 'text-emit' }, '0.1.0')
export const submitted = C.event('submitted', 'The user sent the text in the input', Type.String())
export const setInput = C.action('set-input', 'Replace the text in the input', Type.String())

export const textEmit = C.define({
  state: () => ({ value: '' }),
  actions: [[setInput, (v, { state }) => { state.value = v }]],
})
