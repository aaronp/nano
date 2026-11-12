// The host UI kit: reusable Lit pieces any host can use — the profile and File menus.
import type { Catalog } from '@pritzlaff/nano-elements'
import { Profile } from './profile'

export { Profile }
export { initials, safeAvatar, type Entry, type User } from './profile'
export { defineShell, ProfileEl } from './profile-el'
export { FileMenuEl } from './file-menu-el'

/** The shell's kinds of component, for a host to list (and the Application to make). */
export const catalog = {
  profile: { component: Profile, title: 'Profile', tag: 'nano-profile' },
} satisfies Catalog
