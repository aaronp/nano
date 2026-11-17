/**
 * The auth contract (example-only): `authenticate(purpose)` asks the user for a passkey; `authenticated` is each
 * success. A result carries only ok, purpose, at, credentialId and reason: never a PRF output or key material.
 */
import { Type, type Static } from 'typebox'
import { Coord, Interface, Op, Schema } from '@pritzlaff/nano-core'

export namespace AuthDef {
  export const ns = Coord.namespace('example.auth')

  export const Result = Schema.define(Type.Object({
    ok: Type.Boolean(), purpose: Type.String(), at: Type.String(), credentialId: Type.Optional(Type.String()), reason: Type.Optional(Type.String()),
  }, { additionalProperties: false }))
  export type Result = Static<typeof Result>

  export const api = ns.interface('Auth', {
    authenticate: Op.action(Type.String(), Result),
    authenticated: Op.event(Result),
  })
  export type Auth = Interface.Type<typeof api>
}
