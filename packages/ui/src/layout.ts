/**
 * The old layout convention, kept for reading old documents: `AppDeployment.layout` held `slots` (placed pods) and
 * their `geometry`. Pages now live in the Outline (`@pritzlaff/nano-outline`); the workspace migrates a legacy
 * layout into it.
 */

/** A placed pod. `id` is the slot's engine-neutral name. */
export type LayoutSlot = { id: string; runtime: string; pod: string }
/** Where a slot sits, as fractions (0..1) of the page. */
export type LayoutBox = { x: number; y: number; w: number; h: number }
/** The neutral part of `AppDeployment.layout`; `geometry` is keyed by slot id. */
export type LayoutData = { slots?: LayoutSlot[]; geometry?: Record<string, LayoutBox> }
