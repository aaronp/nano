// The app kept in this browser: the working copy (`nano.working`), named saved apps (`nano.apps`), the current name
// (`nano.app`) and the title (`nano.title`). A storage error (quota) is returned as a sentence and changes nothing.
import { canonicalApp, checkApp, type NanoApp } from '@composable/shell'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export const WORKING = 'nano.working', APPS = 'nano.apps', CURRENT = 'nano.app', TITLE = 'nano.title'

export const appStore = (storage: Store) => {
  const read = (key: string): unknown => { try { const v = storage.getItem(key); return v === null ? null : JSON.parse(v) } catch { return null } }
  const put = (key: string, text: string): string | null => {
    try { storage.setItem(key, text); return null } catch (e) { return `This browser could not store it (${e instanceof Error ? e.message : 'storage is full'}).` }
  }
  const apps = (): Record<string, NanoApp> => {
    const v = read(APPS), out: Record<string, NanoApp> = {}
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) { const a = checkApp(x); if (typeof a !== 'string') out[k] = a }
    return out
  }
  const name = (): string | null => { try { return storage.getItem(CURRENT) || null } catch { return null } }
  return {
    working: (): NanoApp | null => { const a = checkApp(read(WORKING)); return typeof a === 'string' ? null : a },
    setWorking: (a: NanoApp) => put(WORKING, JSON.stringify(a)),
    apps,
    save: (n: string, a: NanoApp) => put(APPS, JSON.stringify({ ...apps(), [n]: a })),
    name,
    setName: (n: string | null) => { try { if (n === null) storage.removeItem(CURRENT); else storage.setItem(CURRENT, n) } catch { /* the name lasts for this visit only */ } },
    /** Unsaved changes: the app differs from the named app it was saved as or opened from, or has no name yet. */
    dirty: (a: NanoApp): boolean => { const n = name(), saved = n === null ? undefined : apps()[n]; return !saved || canonicalApp(a) !== canonicalApp(saved) },
  }
}

/** The title store: `nano.title` (default "Nano"); setting it also puts it on the app bar and `document.title`. */
export const titleStore = (storage: Store, doc: Document) => {
  const get = () => { try { return storage.getItem(TITLE) || 'Nano' } catch { return 'Nano' } }
  const show = (t = get()) => { doc.title = t; const el = doc.querySelector('[slot="title"]'); if (el) el.textContent = t }
  return {
    get, show,
    set: (t: string) => { try { storage.setItem(TITLE, t) } catch { /* shown, not kept */ } show(t); doc.dispatchEvent(new CustomEvent('nano:changed')) },
  }
}
