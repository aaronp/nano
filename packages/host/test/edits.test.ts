// The page edits: pure functions returning the next Outline (undefined: refused), each keeping the tree valid.
import { expect, test } from 'bun:test'
import { Coord } from '@pritzlaff/nano-core'
import { Outline } from '@pritzlaff/nano-outline'
import { addPage, addSlot, movePage, removePage, removeSlot, retitle } from '../src/index.ts'

const tree: Outline = { roots: ['a', 'b'], pages: { a: { slots: {}, children: ['c'] }, b: { slots: {} }, c: { slots: {}, children: ['d'] }, d: { slots: {} } } }
/** `o` is a tree (parse refuses one that is not) and returned. */
const valid = (o: Outline | undefined): Outline => {
  if (!o) throw new Error('refused')
  const r = Outline.parse(JSON.parse(JSON.stringify(o)))
  if (!r.ok) throw new Error(r.fail.reason)
  return o
}

test('addPage: an id from the title (the slug rule, unique), a root or the last child of its parent; an unknown parent refused', () => {
  const one = valid(addPage(tree, 'My Page!'))
  expect(one.roots).toEqual(['a', 'b', 'my-page'])
  expect(one.pages['my-page']).toEqual({ slots: {}, title: 'My Page!' })
  expect(valid(addPage(one, 'my page', 'c')).pages['c']!.children).toEqual(['d', 'my-page-2'])
  expect(valid(addPage(tree, '!!!')).roots).toEqual(['a', 'b', 'page'])
  expect(addPage(tree, 'X', 'nope')).toBeUndefined()
  expect(tree.roots).toEqual(['a', 'b'])   // pure
})

test('removePage: the page and its subtree, out of its parent\'s list; an unknown page refused', () => {
  const next = valid(removePage(tree, 'c'))
  expect(Object.keys(next.pages)).toEqual(['a', 'b'])
  expect(next.pages['a']!.children).toEqual([])
  expect(valid(removePage(tree, 'a'))).toEqual({ roots: ['b'], pages: { b: { slots: {} } } })
  expect(removePage(tree, 'nope')).toBeUndefined()
})

test('movePage: to an index of a parent\'s children (undefined: the roots), counted without it; into its own subtree or past the end refused', () => {
  expect(valid(movePage(tree, 'b', undefined, 0)).roots).toEqual(['b', 'a'])
  const under = valid(movePage(tree, 'd', 'b', 0))
  expect([under.pages['c']!.children, under.pages['b']!.children]).toEqual([[], ['d']])
  expect(valid(movePage(tree, 'c', undefined, 2)).roots).toEqual(['a', 'b', 'c'])
  expect(movePage(tree, 'a', 'd', 0)).toBeUndefined()        // its own subtree
  expect(movePage(tree, 'a', 'a', 0)).toBeUndefined()
  expect(movePage(tree, 'b', undefined, 2)).toBeUndefined()   // past the end, without it
  expect(movePage(tree, 'b', 'nope', 0)).toBeUndefined()
  expect(movePage(tree, 'nope', undefined, 0)).toBeUndefined()
})

test('retitle: only the title; an unknown page refused', () => {
  expect(valid(retitle(tree, 'c', 'See')).pages['c']).toEqual({ slots: {}, children: ['d'], title: 'See' })
  expect(retitle(tree, 'nope', 'x')).toBeUndefined()
})

test('addSlot / removeSlot: a slot under a free id (the pod\'s name, the tool, `select`), added last; removing keeps the rest', () => {
  const pod = Coord.pod(Coord.parse('implementation', 'acme/thing'), Coord.runtime('main'), 't1')
  const one = valid(addSlot(tree, 'b', { kind: 'pod', pod }))
  const two = valid(addSlot(one, 'b', { kind: 'pod', pod }))
  const three = valid(addSlot(two, 'b', { kind: 'tool', tool: 'systems' }))
  expect(Object.keys(three.pages['b']!.slots)).toEqual(['t1', 't1-2', 'systems'])
  expect(Object.keys(valid(addSlot(tree, 'b', { kind: 'select', select: {} })).pages['b']!.slots)).toEqual(['select'])
  expect(Object.keys(valid(removeSlot(three, 'b', 't1')).pages['b']!.slots)).toEqual(['t1-2', 'systems'])
  expect(addSlot(tree, 'nope', { kind: 'tool', tool: 'x' })).toBeUndefined()
  expect(removeSlot(three, 'b', 'nope')).toBeUndefined()
  expect(removeSlot(three, 'b', 'toString')).toBeUndefined()   // not its own slot
  expect(removeSlot(three, 'nope', 't1')).toBeUndefined()
})
