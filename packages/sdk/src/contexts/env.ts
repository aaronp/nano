import { notAllowed, sameInstance, type Context, type Environment, type Instance, type InstanceRef } from '../types'

const withEnv = (inner: Context, fn: (e: Environment) => Environment): Context => ({
  ...inner,
  capabilities: () => { const c = inner.capabilities(); return { ...c, environment: fn(c.environment) } },
  emit: (e, p, s) => inner.emit(e, p, s),
  call: (t, a, i, s) => inner.call(t, a, i, s),
})

export const expose = (inner: Context): Context => inner
export const mapEnv = withEnv

export function elide(inner: Context, hide: (i: Instance) => boolean): Context {
  const hidden: Instance[] = []
  const prune = (e: Environment): Environment => {
    if (e.type === 'leaf') return e
    const children = e.children.filter(c => !hide(c.instance)).map(prune)
    for (const c of e.children) if (hide(c.instance)) hidden.push(c.instance)
    return { ...e, children }
  }
  const inside = (t: InstanceRef) => hidden.some(h =>
    sameInstance(t, h) || [...h.namespace, h.instance].every((n, i) => t.namespace[i] === n))
  const v = withEnv(inner, prune)
  return {
    ...v,
    call: async (t, a, i, s) => {
      // Refresh the hidden set from the current environment so late-registered instances are covered.
      hidden.length = 0; v.capabilities()
      return inside(t) ? notAllowed('elided') : inner.call(t, a, i, s)
    },
  }
}
