import { Implementation, provide, success } from '@pritzlaff/nano-core'
import { Input } from '../interfaces.ts'

export const input = Implementation.define('nano.ui/input', {
  provides: [Input],
  make: () => [provide(Input, { submit: async v => success(v) })],
})
