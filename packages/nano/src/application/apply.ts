/**
 * What `apply` changes between two deployments: pods by name, and the runtimes whose placing or wiring differs.
 *
 *   diff(a, b)   // { added: ['x'], removed: [], changed: ['c'], rewired: ['r'] }
 */
import { Value } from 'typebox/value'
import type { Deployment } from '../deployment.ts'

export function diff(a: Deployment, b: Deployment) {
  const names = (o: object, p: object) => Object.keys(o).filter(k => !(k in p))
  const runtimes = [...new Set([...Object.keys(a.runtimes), ...Object.keys(b.runtimes)])]
  return {
    added: names(b.pods, a.pods),
    removed: names(a.pods, b.pods),
    changed: Object.keys(b.pods).filter(k => k in a.pods && !Value.Equal(a.pods[k], b.pods[k])),
    rewired: runtimes.filter(id => !Value.Equal(a.runtimes[id]?.pods, b.runtimes[id]?.pods)
      || !Value.Equal(a.runtimes[id]?.subscriptions, b.runtimes[id]?.subscriptions)),
  }
}
