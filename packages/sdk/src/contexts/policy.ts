import { allows, notAllowed, sameInstance, type ActionRef, type Context, type EventRef, type InstanceRef, type Policy } from '../types'

export type PolicyStore = { events: Policy<EventRef>; actions: Policy<ActionRef> }
export interface PolicyContext extends Context { setPolicy(next: Partial<PolicyStore>): void }

const sameEvent = (a: EventRef, b: EventRef) => a.event === b.event && sameInstance(a.instance, b.instance)
const sameAction = (a: ActionRef, b: ActionRef) => a.action === b.action && sameInstance(a.instance, b.instance)

export function policy(inner: Context, store: PolicyStore, self: InstanceRef): PolicyContext {
  return {
    capabilities: () => ({ ...inner.capabilities(), events: store.events, actions: store.actions }),
    emit: (event, payload, scope) =>
      allows(store.events, { instance: self, event }, sameEvent)
        ? inner.emit(event, payload, scope) : Promise.resolve(notAllowed(`event ${event} denied by policy`)),
    call: (target, action, input, scope) =>
      allows(store.actions, { instance: target, action }, sameAction)
        ? inner.call(target, action, input, scope) : Promise.resolve(notAllowed(`action ${action} denied by policy`)),
    setPolicy: next => Object.assign(store, next),
  }
}
