import type { Component } from '@pritzlaff/nano-core'

export type CatalogEntry = { component: Component; title?: string; tag?: string; modes?: readonly string[] }

export type AppCatalog = Record<string, CatalogEntry>
