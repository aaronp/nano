// What the views treat as infrastructure rather than a user's components: the host's own listeners and registry, and
// whatever a view owns (an element's hidden subscriber). Shared by the systems tree, the wiring view and the circuit view.
import type { Snapshot } from '@pritzlaff/nano-core'
import { HOST_DRIVEN } from './document'

/** The ids of a snapshot's instances owned by a view (an element's hidden subscriber). */
export const viewIds = (s: Snapshot): Set<string> => new Set(s.instances.filter(i => i.owner?.kind === 'view').map(i => i.id))

/** Whether an id is infrastructure: the registry or a host-driven listener (HOST_DRIVEN), or a view's (`views`, from viewIds). */
export const isInfrastructure = (id: string, views: ReadonlySet<string>): boolean => HOST_DRIVEN(id) || views.has(id)
