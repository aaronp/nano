/**
 * The layout convention: which pods are on the page and where, engine-neutral, inside `AppDeployment.layout` (the
 * deployer's plain object). Each layout engine keeps its own state beside it under its own key.
 *
 *   "layout": {
 *     "slots": [{ "id": "a", "runtime": "frontend", "pod": "listA" }, { "id": "b", "runtime": "frontend", "pod": "listB" }],
 *     "geometry": { "a": { "x": 0, "y": 0, "w": 0.5, "h": 1 }, "b": { "x": 0.5, "y": 0, "w": 0.5, "h": 1 } },
 *     "workspace": { ...golden-layout's own state }
 *   }
 *
 * A slot's key is the pod's instance coordinate; a pod has at most one view (its implementation's, from the provider
 * module's `views`, or the deployment's `views` override). A pod not in `slots` runs unseen.
 */
/** A placed pod. `id` is the slot's engine-neutral name. */
export type LayoutSlot = { id: string; runtime: string; pod: string }
/** Where a slot sits, as fractions (0..1) of the page. */
export type LayoutBox = { x: number; y: number; w: number; h: number }
/** The neutral part of `AppDeployment.layout`; `geometry` is keyed by slot id. */
export type LayoutData = { slots?: LayoutSlot[]; geometry?: Record<string, LayoutBox> }
