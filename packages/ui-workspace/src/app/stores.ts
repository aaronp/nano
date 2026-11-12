// The host's real stores for a document: localStorage and the document (theme, title). Workspaces are the Application's screens.
import { KEY as IMPORTS, importsStore } from '../lib/imports.ts'
import { applyChoice, loadChoice } from '../lib/theme-state.ts'
import type { Stores } from './snapshot.ts'

/** `title` is the host's title store (Task 4's), since the app bar and `document.title` follow it. */
export const realStores = (doc: Document, storage: Storage, title: Stores['title']): Stores => ({
  imports: { list: () => importsStore(storage).list(), set: xs => storage.setItem(IMPORTS, JSON.stringify(xs)) },
  theme: { get: () => loadChoice().choice, set: c => applyChoice(doc, c) },
  title,
})
