/**
 * Start-up of the app (after the theme and composable, before the saved workspaces mount): the title; the working
 * copy applied if there is one (it is then the source of truth, and bootImports is skipped); autosave begins from
 * `startAutosave()`, which boot-saved-workspaces calls when it is done, so a half-started page never overwrites the copy.
 */
import { host, catalog } from './composable.ts'
import { loadPackage } from './imports.ts'
import { setImportFailures } from './lib/import-failures.ts'
import { realStores } from './app/stores.ts'
import { appStore, titleStore } from './app/store.ts'
import { autosave, restoreApp } from './app/boot.ts'

export const title = titleStore(localStorage, document)
export const app = appStore(localStorage)
const stores = realStores(document, localStorage, title)
title.show()

const r = await restoreApp({ host, stores, app, catalog,
  importPackage: async (url, trust) => { const got = await loadPackage(url, undefined, trust); return 'error' in got ? { error: got.error } : { name: got.manifest.name, version: got.manifest.version } } })
if (r.restored) {
  setImportFailures(r.failed)
  for (const n of r.notes) console.warn('working copy:', n)
}
export const restored = r.restored
export const startAutosave = () => autosave({ host, stores, app, doc: document })
