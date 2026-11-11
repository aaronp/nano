// Folders: the mail folders and the current one; each change of folder is published as `selected`.
import { Type } from 'typebox'
import { component, event, state } from '@pritzlaff/nano-runes'
import { FOLDERS } from './sample-data'
import { FolderId } from './schemas'

const Folder = Type.Object({ id: FolderId, name: Type.String({ maxLength: 100, description: 'What the folder is called', examples: ['Inbox'] }) }, { description: 'A folder' })

const Config = Type.Object({ folders: Type.Array(Folder, { minItems: 1, maxItems: 200, description: 'The folders, in order' }), current: FolderId },
  { description: 'The settings: the folders and the current one', examples: [{ folders: [{ id: 'inbox', name: 'Inbox' }], current: 'inbox' }] })

/** The folders and which one is current. `select` refuses an id that isn't a folder; new folders (at least one, unique ids) keep the current one if it still exists, else the first is current.
 * (The getter is `current` because `selected` is the event, and an op key names one member.) */
export const Folders = component('nano.inbox/folders', () => {
  const s = state({ folders: FOLDERS.map(f => ({ ...f })), current: 'inbox' })
  const selected = event(FolderId)
  const set = (id: string) => { if (id !== s.current) { s.current = id; selected(id) } }
  const unique = (list: { id: string }[]) => {
    const dup = list.find((f, i) => list.findIndex(g => g.id === f.id) !== i)
    if (dup) throw new Error(`duplicate folder id ${JSON.stringify(dup.id)}`)
  }
  const setFolders = (list: { id: string; name: string }[]) => {
    unique(list)
    s.folders = list.map(f => ({ id: f.id, name: f.name }))
    if (!list.some(f => f.id === s.current)) set(list[0]?.id ?? '')
  }
  return {
    get folders() { return s.folders }, get current() { return s.current },
    selected,
    get config() { return { folders: s.folders, current: s.current } },
    configure: (c: { folders: { id: string; name: string }[]; current: string }) => {
      if (!c.folders.some(f => f.id === c.current)) throw new Error(`${JSON.stringify(c.current)} is not one of the folders`)
      unique(c.folders)
      s.folders = c.folders.map(f => ({ id: f.id, name: f.name })); set(c.current)
    },
    select: (id: string) => {
      if (!s.folders.some(f => f.id === id)) throw new Error(`${JSON.stringify(id)} is not a folder`)
      set(id)
    },
    setFolders,
  }
}, {
  folders: Type.Array(Folder, { maxItems: 200, description: 'The folders, in order', examples: [[{ id: 'inbox', name: 'Inbox' }]] }),
  current: Type.String({ maxLength: 40, description: 'The id of the current folder', examples: ['inbox'] }),
  config: Config,
  configure: { in: Config, description: 'Replaces the folders and the current one; refuses no folders, duplicate ids or a current that is not a folder, changing nothing' },
  selected: Type.String({ maxLength: 40, description: 'The id of the folder chosen, whenever the current one changes', examples: ['sent'] }),
  select: { in: FolderId, description: 'Makes a folder current; refuses an id that is not one of the folders' },
  setFolders: { in: Type.Array(Folder, { minItems: 1, maxItems: 200, description: 'The new folders' }),
    description: 'Replaces the folders, keeping the current one if it is still there (else the first; at least one folder, ids unique)' },
}, { description: 'Mail folders, one of them current' })
