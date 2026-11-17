/**
 * A module's `built` stamp (the nano-core its bundle was built with) against this workspace's own.
 *
 *   newerCore('acme.x', { '@pritzlaff/nano-core': '0.5.0' })   // 'acme.x was built with nano-core 0.5.0; this workspace has 0.4.0'
 */
import { version } from '../../nano/package.json'

export type Built = Record<string, string>

/** major and minor, compared as numbers: a patch is never warned about. */
const minor = (v: string) => { const [a = 0, b = 0] = v.split('.').map(Number); return a * 1e6 + b }

/** The warning when `coord` was built with a newer nano-core (major or minor) than `own`; else undefined. */
export function newerCore(coord: string, built: Built | undefined, own = version): string | undefined {
  const theirs: unknown = built?.['@pritzlaff/nano-core']
  // A stamp is untrusted data (a cross-origin module's): only a plain, short semver is read, never thrown on or shown raw.
  if (typeof theirs !== 'string' || !/^\d{1,6}\.\d{1,6}\.\d{1,6}(-[\w.]{1,32})?$/.test(theirs)) return undefined
  return minor(theirs) > minor(own) ? `${coord} was built with nano-core ${theirs}; this workspace has ${own}` : undefined
}
