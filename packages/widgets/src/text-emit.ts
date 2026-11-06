import Type from 'typebox'
import { Components } from '@composable/sdk'

const C = Components.declare({ author: 'composable', id: 'text-emit' })
export const submitted = C.op('submitted', 'The user sent the text in the input', { output: Type.String() })
export const setInput = C.op('set-input', 'Replace the text in the input', { input: Type.String() })

export const textEmit = C.define({
  state: () => ({ value: '' }),
  handlers: [[setInput, (v, { state }) => { state.value = v }]],
})
