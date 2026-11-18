import { Type } from 'typebox'
import { Coord, Implementation, Schema, provide, success } from '@pritzlaff/nano-core'
import { Input } from '../interfaces.ts'

const ns = Coord.namespace('nano.ui')
/** What its view shows: a line of text, a text area, a number or a checkbox. The pod itself only returns its input. */
export const KINDS = ['text', 'textarea', 'number', 'boolean'] as const
export type InputKind = typeof KINDS[number]

export const input = Implementation.define(ns.implementationId('input'), {
  provides: [Input],
  config: Schema.define(Type.Union([Type.Object({ kind: Type.Optional(Type.Union(KINDS.map(k => Type.Literal(k)))) }), Type.Undefined()]), 'InputConfig'),
  make: () => [provide(Input, { submit: async v => success(v), change: async v => success(v) })],
})
