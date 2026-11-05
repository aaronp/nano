import { allows, notAllowed, sameInstance, type ActionRef, type Context, type Environment, type EventRef, type Instance, type InstanceRef, type Policy } from '../types'
import { Calls } from './wrappers'

export type PolicyStore = { events: Policy<EventRef>; actions: Policy<ActionRef> }
const sameEvent = (a: EventRef, b: EventRef) => a.event === b.event && sameInstance(a.instance, b.instance)
const sameAction = (a: ActionRef, b: ActionRef) => a.action === b.action && sameInstance(a.instance, b.instance)

/** Enforce a (shared, mutable) policy store on a context: emits, calls, and what capabilities report. */
export const policy = (store: PolicyStore) => (ctx: Context): Context => ctx
  .withEmit((e, next) => allows(store.events, { instance: ctx.self, event: e.event.name }, sameEvent)
    ? next(e) : Promise.resolve(notAllowed(`event ${e.event.name} denied by policy`)))
  .withCall((c, next) => allows(store.actions, { instance: c.target, action: c.action.name }, sameAction)
    ? next(c) : Promise.resolve(notAllowed(`action ${c.action.name} denied by policy`)))
  .withCapabilities(c => ({ ...c, events: store.events, actions: store.actions }))

/** Hide instances (and their subtrees) from the environment, and refuse calls into them. */
export const elide = (hide: (i: Instance) => boolean) => (ctx: Context): Context => {
  const hidden = (t: InstanceRef, e: Environment): boolean => {
    const here = sameInstance(t, e.instance) || [...e.instance.namespace, e.instance.instance].every((n, i) => t.namespace[i] === n)
    if (hide(e.instance)) return here
    return e.type === 'node' && e.children.some(c => hidden(t, c))
  }
  const prune = (e: Environment): Environment =>
    e.type === 'leaf' ? e : { ...e, children: e.children.filter(c => !hide(c.instance)).map(prune) }
  return ctx
    .withCapabilities(c => ({ ...c, environment: prune(c.environment) }))
    .withCall(Calls.filter(c => !hidden(c.target, ctx.capabilities().environment)))
}
