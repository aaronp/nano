/**
 * The Platform (ADR-0038): pages over an Application, as their own document, the UIDeployment, changed by one `apply`.
 * Framework-free; depends on nano-core only, which knows nothing of pages.
 *
 *   const platform = Platform.create(app, registry, Platform.parse(saved).value)
 */
export { readSelector, type Page, type Slot, type UIDeployment } from './document.ts'
export { targets } from './targets.ts'
export { Platform } from './platform.ts'
export { HostPlatform, DocAt, ApplyAt } from './host-platform.ts'
