// Pages in the layout, and HostPages' schemas.
import { expect, spyOn, test } from 'bun:test'
import { Value } from 'typebox/value'
import { HostPages, pagesOf } from '../src/index.ts'

const page = { id: 'main', title: 'Main', slots: [{ id: 'a', runtime: 'r', pod: 'p' }, { id: 'v', view: 'nano-x' }], geometry: { a: { x: 0, y: 0, w: 1, h: 1 } }, workspace: { k: 1 } }

test('pagesOf returns the pages, dropping and warning on a bad one', () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  expect(pagesOf({ pages: [page, { id: 'bad/id', title: 'x', slots: [] }, { id: 'x', title: 'X', slots: [{ id: 'a' }] }] })).toEqual([page])
  expect(warn).toHaveBeenCalledTimes(2)
  warn.mockRestore()
})

test('pagesOf makes a legacy layout one page', () => {
  const slots = [{ id: 'a', runtime: 'r', pod: 'p' }], geometry = { a: { x: 0, y: 0, w: 1, h: 1 } }
  expect(pagesOf({ slots, geometry, workspace: { k: 1 } })).toEqual([{ id: 'workspace', title: 'Workspace', slots, geometry, workspace: { k: 1 } }])
  expect(pagesOf({ slots })).toEqual([{ id: 'workspace', title: 'Workspace', slots }])
  expect(pagesOf({})).toEqual([])
  expect(pagesOf(undefined)).toEqual([])
})

test('HostPages ops take pages holding pod and view slots', () => {
  const { pages, setPage, removePage, open } = HostPages.ops
  expect(Value.Check(pages.input!, null)).toBe(true)
  expect(Value.Check(pages.output!, [page])).toBe(true)
  expect(Value.Check(setPage.input!, { page })).toBe(true)
  expect(Value.Check(setPage.input!, { page, index: 0 })).toBe(true)
  expect(Value.Check(setPage.input!, { index: 0 })).toBe(false)
  expect(Value.Check(removePage.input!, 'main')).toBe(true)
  expect(Value.Check(open.input!, 'main')).toBe(true)
  expect(Value.Check(open.output!, null)).toBe(true)
})
