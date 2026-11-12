import type { Component } from '@pritzlaff/nano-core'

export type CatalogEntry = { component: Component; title?: string; tag?: string; modes?: readonly string[]; /** names of the ops that take JavaScript: a document needs consent to use them */ code?: string[] }

export type AppCatalog = Record<string, CatalogEntry>
