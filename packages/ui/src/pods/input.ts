import { Coord, Implementation, provide, success } from '@pritzlaff/nano-core'
import { Input } from '../interfaces.ts'

const ns = Coord.namespace('nano.ui')

export const input = Implementation.define(ns.implementationId('input'), {
  provides: [Input],
  make: () => [provide(Input, { submit: async v => success(v) })],
})
