import { isThemeId } from '../lib/themes.ts'
import { ICONS } from '../lib/saved-workspaces.ts'

/** What this host knows, for applying a document: its themes and its icons. */
export const known = { theme: isThemeId, icon: (name: string) => Object.hasOwn(ICONS, name) }
