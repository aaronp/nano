/**
 * Start-up of the app (after the theme and composable, before the saved workspaces mount): the title; the working
 * copy applied if there is one (it is then the source of truth, and bootImports is skipped); autosave begins from
 * `startAutosave()`, which boot-saved-workspaces calls when it is done, so a half-started page never overwrites the copy.
 */
import { host, catalog } from './composable.ts'
import { loadPackage } from './imports.ts'
import { setImportFailures } from './lib/import-failures.ts'
import { showStatus } from './lib/status.ts'
import { realStores } from './app/stores.ts'
import { appStore, titleStore } from './app/store.ts'
import { autosave, restoreApp } from './app/boot.ts'

export const title = titleStore(localStorage, document)
export const app = appStore(localStorage)
const stores = realStores(document, localStorage, title)
title.show()

export const importPackage = async (url: string, trust: 'trusted' | 'sandboxed') => { const got = await loadPackage(url, undefined, trust); return 'error' in got ? { error: got.error } : { name: got.manifest.name, version: got.manifest.version } }
export { stores }
const r = await restoreApp({ host, stores, app, catalog, importPackage })
if (r.restored) setImportFailures(r.failed)
for (const n of r.notes) console.warn('working copy:', n)
if (r.say) showStatus(document, r.say)
export const restored = r.restored
let auto: ReturnType<typeof autosave> | undefined
export const startAutosave = () => { auto = autosave({ host, stores, app, doc: document, initial: !r.protect, onError: why => showStatus(document, `Your work could not be saved in this browser: ${why}`), onWrite: () => document.dispatchEvent(new CustomEvent('nano:working-saved')) }) }
export const stopAutosave = () => auto?.stop()
