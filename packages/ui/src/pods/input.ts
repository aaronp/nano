import { implementation, provide, success } from '@pritzlaff/nano-core'
import { Input } from '../interfaces.ts'

export const input = implementation('nano.ui/input', {
  provides: [Input],
  make: () => [provide(Input, { submit: async v => success(v) })],
})
