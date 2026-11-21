/**
 * The Outline (ADR-0040): a tree of pages over an Application, as their own document, changed by one `apply`.
 * Framework-free; depends on nano-core only, which knows nothing of pages.
 *
 *   const outline = Outline.create(app, registry, Outline.parse(saved).value)
 */
export { readSelector, type Page, type Slot } from './document.ts'
export { targets } from './targets.ts'
export { Outline, resolve } from './outline.ts'
export { HostOutline, DocAt, ApplyAt } from './host-outline.ts'
