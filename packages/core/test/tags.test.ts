import { expect, test } from 'bun:test'
import { Tags, type TagChange } from '../src'

const watched = () => { const t = Tags.create<string>(), seen: TagChange<string>[] = []; t.listen(c => { seen.push(c) }); return { t, seen } }

test('tag then tagged and tagsOf answer both ways', () => {
  const { t } = watched()
  t.tag('a', 'x'); t.tag('a', 'y'); t.tag('b', 'x')
  expect([...t.tagged('x')].sort()).toEqual(['a', 'b'])
  expect([...t.tagsOf('a')].sort()).toEqual(['x', 'y'])
})

test('tagging twice is a no-op', () => {
  const { t, seen } = watched()
  expect(t.tag('a', 'x')).toBe(true)
  expect(t.tag('a', 'x')).toBe(false)
  expect(seen).toHaveLength(1)
})

test('the last untag leaves nothing behind', () => {
  const { t } = watched()
  t.tag('a', 'x')
  expect(t.untag('a', 'x')).toBe(true)
  expect(t.tagged('x').size).toBe(0)
  expect(t.all().has('a')).toBe(false)
  expect(t.untag('a', 'x')).toBe(false)
})

test('remove forgets an item', () => {
  const { t, seen } = watched()
  t.tag('a', 'x'); t.tag('a', 'y')
  t.remove('a')
  expect(seen.slice(2)).toEqual([{ item: 'a', tag: 'x', added: false }, { item: 'a', tag: 'y', added: false }])
  expect(t.tagged('x').size).toBe(0)
  expect(t.tagged('y').size).toBe(0)
  expect(t.all().size).toBe(0)
})

test('tags are trimmed, non-empty and at most 64 characters', () => {
  const { t } = watched()
  t.tag('a', '  x ')
  expect([...t.tagsOf('a')]).toEqual(['x'])
  expect(() => t.tag('a', '')).toThrow(/1 to 64 characters/)
  expect(() => t.tag('a', 'x'.repeat(65))).toThrow(/1 to 64 characters/)
})

test('the sets it returns are copies', () => {
  const { t } = watched()
  t.tag('a', 'x');
  (t.tagged('x') as Set<string>).add('zzz');
  (t.tagsOf('a') as Set<string>).add('zzz')
  expect([...t.tagged('x')]).toEqual(['a'])
  expect([...t.tagsOf('a')]).toEqual(['x'])
})
