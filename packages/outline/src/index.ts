/**
 * The Outline (ADR-0040): a tree of pages over an Application, as their own document: pure data and functions.
 * Framework-free; depends on nano-core only, which knows nothing of pages.
 *
 *   const doc = Outline.parse(saved).value;  resolve(doc, 'home', app.deployment(), registry)
 */
export { readSelector, type Page, type Slot } from './document.ts'
export { targets } from './targets.ts'
export { movedPages } from './tree.ts'
export { Outline, resolve } from './outline.ts'
export { HostOutline, DocAt, ApplyAt } from './host-outline.ts'
