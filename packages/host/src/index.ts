/**
 * The host core (ADR-0041): framework-free, shared by every host. One host document (`HostDocument`) under one storage
 * key, booted into the one Application (`Host.boot`). Depends on nano-core and nano-outline only.
 *
 *   const h = (await Host.boot(localStorage, { base: location.href })).value
 */
export type { HostDocument } from './document.ts'
export { Host } from './boot.ts'
