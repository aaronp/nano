// Save a person, in four layers: a form (app), a bff, an api and storage. Swap the storage; wrap the rules.
import type { Catalog } from '@pritzlaff/nano-elements'
import { MemoryDb } from './memory-db'
import { PersonForm } from './person-form'
import { PersonRules, PersonService, WebBff } from './providers'

export * from './interfaces'
export { MemoryDb, PersonForm, PersonRules, PersonService, WebBff }
export type { Entry } from './memory-db'

/** The example's kinds: the db and form have elements; the layers between are headless. */
export const catalog = {
  'people-db': { component: MemoryDb, title: 'People DB', tag: 'c-people-db' },
  'person-rules': { component: PersonRules, title: 'Person rules' },
  'person-service': { component: PersonService, title: 'Person service' },
  'people-bff': { component: WebBff, title: 'People BFF' },
  'person-form': { component: PersonForm, title: 'Person form', tag: 'c-person-form' },
} satisfies Catalog
export * from './elements'
