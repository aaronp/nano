// The app kept in this browser: the working copy (`nano.working`), named saved apps (`nano.apps`), the current name
// (`nano.app`) and the title (`nano.title`). A storage error (quota) is returned as a sentence and changes nothing.
import { canonicalApp, checkApp, type NanoApp } from '@composable/shell'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export const WORKING = 'nano.working', APPS = 'nano.apps', CURRENT = 'nano.app', TITLE = 'nano.title'
// the baseline (`nano.app.base`: the canonical app last opened, saved or started fresh), whether it still has to be re-read from the running app (`nano.app.rebase`), and notes for the next start (`nano.working.notes`)
export const BASE = 'nano.app.base', REBASE = 'nano.app.rebase', NOTES = 'nano.working.notes'

export const appStore = (storage: Store) => {
  const read = (key: string): unknown => { try { const v = storage.getItem(key); return v === null ? null : JSON.parse(v) } catch { return null } }
  const put = (key: string, text: string): string | null => {
    try { storage.setItem(key, text); return null } catch (e) { return `This browser could not store it (${e instanceof Error ? e.message : 'storage is full'}).` }
  }
  const apps = (): Record<string, NanoApp> => {
    const v = read(APPS), out: Record<string, NanoApp> = Object.create(null)   // not {}: a name like __proto__ is an ordinary key
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) { const a = checkApp(x); if (typeof a !== 'string') out[k] = a }
    return out
  }
  const name = (): string | null => { try { return storage.getItem(CURRENT) || null } catch { return null } }
  return {
    /** The working copy's text as stored, valid or not. */
    rawWorking: (): string | null => { try { return storage.getItem(WORKING) } catch { return null } },
    /** Keeps text a restore could not use, beside the working copy: 'bad' (unreadable) or 'unrestored' (partly applied); the newest wins. */
    stashed: (which: 'bad' | 'unrestored'): string | null => { try { return storage.getItem(`${WORKING}.${which}`) } catch { return null } },
    stash: (which: 'bad' | 'unrestored', text: string) => put(`${WORKING}.${which}`, text),
    discard: (which: 'bad' | 'unrestored') => { try { storage.removeItem(`${WORKING}.${which}`) } catch { /* it stays */ } },
    working: (): NanoApp | null => { const a = checkApp(read(WORKING)); return typeof a === 'string' ? null : a },
    setWorking: (a: NanoApp) => put(WORKING, JSON.stringify(a)),
    apps,
    save: (n: string, a: NanoApp) => { const all = apps(); all[n] = a; return put(APPS, JSON.stringify(all)) },
    name,
    /** A failed write is returned as a sentence. */
    setName: (n: string | null): string | null => { try { if (n === null) storage.removeItem(CURRENT); else storage.setItem(CURRENT, n); return null } catch (e) { return `This browser could not keep the name (${e instanceof Error ? e.message : 'storage is full'}).` } },
    /** The app as last opened, saved or started fresh: what "unsaved" is measured from. */
    setBase: (a: NanoApp): string | null => { const e = put(BASE, canonicalApp(a)); try { storage.removeItem(REBASE) } catch { /* read again next start */ } return e },
    /** The baseline is missing, or is a document waiting to be re-read from the running app (a document read back through the host may differ in form). */
    needsBase: (): boolean => { try { return storage.getItem(BASE) === null || storage.getItem(REBASE) !== null } catch { return false } },
    /** Unsaved changes: the app differs (canonically) from the baseline. */
    dirty: (a: NanoApp): boolean => { try { const b = storage.getItem(BASE); return b === null || canonicalApp(a) !== b } catch { return true } },
    /** Replaces the working copy, the baseline, the name and the notes for the next start together: if any write fails, all are put back and the sentence is returned. */
    adopt: (doc: NanoApp, name: string | null, notes: string[] = []): string | null => {
      const keys = [WORKING, BASE, REBASE, CURRENT, NOTES], before = keys.map(k => { try { return storage.getItem(k) } catch { return null } })
      try {
        storage.setItem(WORKING, JSON.stringify(doc)); storage.setItem(BASE, canonicalApp(doc)); storage.setItem(REBASE, '1')
        if (name === null) storage.removeItem(CURRENT); else storage.setItem(CURRENT, name)
        if (notes.length) storage.setItem(NOTES, JSON.stringify(notes)); else storage.removeItem(NOTES)
        return null
      } catch (e) {
        keys.forEach((k, i) => { try { if (before[i] === null) storage.removeItem(k); else storage.setItem(k, before[i]!) } catch { /* nothing more can be done */ } })
        return `This browser could not store it (${e instanceof Error ? e.message : 'storage is full'}); nothing was changed.`
      }
    },
    /** Notes left for this start, once. */
    takeNotes: (): string[] => { const v = read(NOTES); try { storage.removeItem(NOTES) } catch { /* shown again */ } return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] },
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
