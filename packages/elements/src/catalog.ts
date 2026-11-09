// What a package offers a host: its kinds of component, each with a title and (if it has one) its element.
import type { Component } from '@pritzlaff/nano-core'

/** One kind of component: the component, a title for people, and the tag of the element that shows it. */
export type CatalogEntry = { component: Component; title: string; tag?: string }
/** A package's kinds of component, by kind. A host merges these to list everything it can make. */
export type Catalog = Record<string, CatalogEntry>
