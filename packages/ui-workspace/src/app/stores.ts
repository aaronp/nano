// The host's real stores for a document: localStorage and the document (theme, title, a workspace's dock layout).
import { KEY as IMPORTS, importsStore } from '../lib/imports.ts'
import { KEY, savedWorkspaces, type SavedWorkspace } from '../lib/saved-workspaces.ts'
import { applyChoice, loadChoice } from '../lib/theme-state.ts'
import { keyFor } from '../components/saved-workspaces.ts'
import type { Stores } from './snapshot.ts'

/** `title` is the host's title store (Task 4's), since the app bar and `document.title` follow it. */
export const realStores = (doc: Document, storage: Storage, title: Stores['title']): Stores => ({
  imports: { list: () => importsStore(storage).list(), set: xs => storage.setItem(IMPORTS, JSON.stringify(xs)) },
  workspaces: { list: () => savedWorkspaces(storage).list(), set: (xs: SavedWorkspace[]) => storage.setItem(KEY, JSON.stringify(xs)) },
  layouts: {
    get: path => { try { const v = storage.getItem(keyFor(doc, path)); return v === null ? null : JSON.parse(v) } catch { return null } },
    set: (path, layout) => storage.setItem(keyFor(doc, path), JSON.stringify(layout)),
  },
  theme: { get: () => loadChoice().choice, set: c => applyChoice(doc, c) },
  title,
})
