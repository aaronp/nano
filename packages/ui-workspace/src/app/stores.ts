// The host's real stores for a document: localStorage and the document (theme, title). Workspaces are the Application's screens.
import { KEY as IMPORTS, importsStore } from '../lib/imports.ts'
import { applyChoice, loadChoice, type ThemeChoice } from '../lib/theme-state.ts'
import type { HostStores } from '@pritzlaff/nano-app'

export type Stores = HostStores
/** The profile menu's links to the host's own pages. */
export const HOST_ENTRIES = [{ label: 'Components', href: '#/components' }, { label: 'Settings', href: '#/settings' }, { label: 'Systems', href: '#/systems' }, { label: 'Themes', href: '#/themes' }]

/** `title` is the host's title store (Task 4's), since the app bar and `document.title` follow it. */
export const realStores = (doc: Document, storage: Storage, title: Stores['title']): Stores => ({
  imports: { list: () => importsStore(storage).list(), set: xs => storage.setItem(IMPORTS, JSON.stringify(xs)) },
  theme: { get: () => loadChoice().choice, set: c => applyChoice(doc, c as ThemeChoice) },
  title, hostEntries: HOST_ENTRIES,
})
