import { expect, test } from 'bun:test'
import { catalog, initials, Profile, safeAvatar } from '../src'
import { page } from './fixtures'

test('starts with no name and no entries', async () => {
  const { add, value } = page(); add('p', Profile)
  expect(await value('p', Profile.ops.user)).toEqual({ name: '' })
  expect(await value('p', Profile.ops.entries)).toEqual([])
  expect(catalog.profile.tag).toBe('nano-profile')
})

test('setUser and setEntries replace them', async () => {
  const { add, call, value } = page(); add('p', Profile)
  await call('p', Profile.ops.setUser, { name: 'Ada', avatar: 'https://x.test/a.png' })
  await call('p', Profile.ops.setEntries, [{ label: 'Systems', href: '#/systems' }])
  expect(await value('p', Profile.ops.user)).toEqual({ name: 'Ada', avatar: 'https://x.test/a.png' })
  await call('p', Profile.ops.setEntries, [])
  expect(await value('p', Profile.ops.entries)).toEqual([])
})

test('inputs are checked (name <= 80, label <= 40, href <= 400, at most 20 entries)', async () => {
  const { add, call } = page(); add('p', Profile)
  const bad = async (op: any, arg: unknown) => expect('error' in await call('p', op, arg)).toBe(true)
  await bad(Profile.ops.setUser, { name: 'x'.repeat(81) })
  await bad(Profile.ops.setEntries, [{ label: 'x'.repeat(41), href: '#' }])
  await bad(Profile.ops.setEntries, [{ label: 'a', href: 'x'.repeat(401) }])
  await bad(Profile.ops.setEntries, Array.from({ length: 21 }, () => ({ label: 'a', href: '#' })))
})

test('initials', () => {
  expect(initials('Ada Lovelace')).toBe('AL'); expect(initials('You')).toBe('Y'); expect(initials('')).toBe('?')
})

test('safeAvatar keeps https and data:image, drops the rest', () => {
  expect(safeAvatar('https://x.test/a.png')).toBe('https://x.test/a.png')
  expect(safeAvatar('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
  for (const u of ['javascript:alert(1)', 'data:text/html,<b>', '', undefined]) expect(safeAvatar(u)).toBeUndefined()
})

test('setEntries refuses hrefs that are not #, /, http(s): or mailto:', async () => {
  const { add, call, value } = page(); add('p', Profile)
  for (const href of ['javascript:alert(1)', ' JavaScript:x', 'data:text/html,x', 'vbscript:x'])
    expect('error' in await call('p', Profile.ops.setEntries, [{ label: 'a', href }])).toBe(true)
  const ok = ['#/x', '/x', 'https://x.test', 'HTTP://x.test', 'mailto:a@b.c'].map(href => ({ label: 'a', href }))
  await call('p', Profile.ops.setEntries, ok)
  expect(await value('p', Profile.ops.entries)).toEqual(ok)
})
