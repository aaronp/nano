// The Alerts contract: the host registers an implementation as `alerts`; anything can ask it to show a message.
import { Type, type Static } from 'typebox'
import { component } from '@pritzlaff/nano-runes'

const Show = Type.Object({
  message: Type.String({ maxLength: 500, description: 'What to tell the user', examples: ['Saved'] }),
  tone: Type.Optional(Type.Union([Type.Literal('info'), Type.Literal('success'), Type.Literal('warning'), Type.Literal('error')], { description: 'How it reads; info if omitted' })),
}, { description: 'The message, and its tone' })
export type AlertArgs = Static<typeof Show>

/** An implementation of the contract: the host decides how `show` reaches the user. Same id and ops as `Alerts`. */
export const alerts = (show: (a: AlertArgs) => void) =>
  component('nano.app/alerts', () => ({ show }), { show: { in: Show, description: 'Shows a message to the user' } }, { description: 'Tells the user something, however the host shows it' })

/** The contract itself (a runes component interface, id `nano.app/alerts`); callers use `AlertsOps`. */
export const Alerts = alerts(() => {})
export const AlertsOps = Alerts.ops
