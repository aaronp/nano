// A Profile: who the user is and the menu entries under their avatar. The host fills both; the element shows them.
import { Type } from 'typebox'
import { component, state } from '@pritzlaff/nano-runes'

export type User = { name: string; avatar?: string }
export type Entry = { label: string; href: string }

/** Up to two capital letters from the name's words ('Ada Lovelace' is 'AL'); '?' for no name. */
export const initials = (name: string): string =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0]!.toUpperCase()).join('') || '?'

/** The avatar URL if it is an http(s) or data:image/ one, else undefined: anything else (javascript:) never reaches `src`. */
export const safeAvatar = (url?: string): string | undefined => (url && /^(https?:\/\/|data:image\/)/i.test(url) ? url : undefined)

const User_ = Type.Object({
  name: Type.String({ maxLength: 80, description: 'The name shown (and whose initials stand in for a missing avatar)', examples: ['Ada Lovelace'] }),
  avatar: Type.Optional(Type.String({ maxLength: 100_000, description: 'An image URL (https: or data:image/); without one the initials show', examples: ['https://example.com/ada.png'] })),
}, { description: 'Who the profile is for' })
const Entries = Type.Array(Type.Object({
  label: Type.String({ maxLength: 40, description: 'The text of the menu link', examples: ['Systems'] }),
  href: Type.String({ maxLength: 400, description: 'Where the link goes', examples: ['#/systems'] }),
}), { maxItems: 20, description: 'The menu links, in order', examples: [[{ label: 'Systems', href: '#/systems' }]] })

/** A user and their menu entries; the host sets both. */
export const Profile = component('nano.shell/profile', () => {
  const s = state<{ user: User; entries: Entry[] }>({ user: { name: '' }, entries: [] })
  return {
    get user() { return s.user }, get entries() { return s.entries },
    setUser: (user: User) => { s.user = user },
    setEntries: (entries: Entry[]) => { s.entries = entries },
  }
}, {
  user: User_,
  entries: Entries,
  setUser: { in: User_, description: 'Replaces the user' },
  setEntries: { in: Entries, description: 'Replaces the menu entries' },
}, { description: 'A user and the menu of links under their avatar' })
