/**
 * The host core (ADR-0041): framework-free, shared by every host. One host document (`HostDocument`) under one storage
 * key, booted into the one Application (`Host.boot`), its live outline, deploys and picks, `connect`, and the page edits as pure functions.
 * Depends on nano-core and nano-outline only.
 *
 *   const h = (await Host.boot(localStorage, { base: location.href })).value
 *   h.outline.apply(addPage(h.outline.document().doc, 'Trading')!)
 */
export type { HostDocument } from './document.ts'
export { Host } from './boot.ts'
export { connect } from './connect.ts'
export { addPage, addSlot, movePage, removePage, removeSlot, retitle } from './edits.ts'
