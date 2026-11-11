// Host-page pieces any host can reuse: the profile menu.
import type { Catalog } from '@pritzlaff/nano-elements'
import { Profile } from './profile'

export { Profile }
export { initials, safeAvatar, type Entry, type User } from './profile'
export { defineShell, ProfileEl } from './profile-el'
export { FileMenuEl } from './file-menu-el'
export { NanoAppSchema, checkApp, canonicalApp, RESERVED, MAX_BYTES, type NanoApp } from './app'

/** The shell's kinds of component, for a host to list (and the platform to make). */
export const catalog = {
  profile: { component: Profile, title: 'Profile', tag: 'nano-profile' },
} satisfies Catalog
