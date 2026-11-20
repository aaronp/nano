// A flat write in a test: every page a root, in key order (what `Outline.parse` makes of a flat `{ pages }`).
import type { Outline, Page } from '@pritzlaff/nano-outline'

export const flat = (pages: Record<string, Page>): Outline => ({ roots: Object.keys(pages), pages })
