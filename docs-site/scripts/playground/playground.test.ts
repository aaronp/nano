import { expect, test } from 'bun:test'
import { accept } from './messages'
import { frameDoc, sharedBase } from './frame'
import { stripMarkers } from './strip'
import { transpile } from './transpile'

test('stripMarkers drops region lines and keeps code', () => {
  const src = '// #region x\nconst a = 1\n  // #endregion x\nconst b = 2\n'
  expect(stripMarkers(src)).toBe('const a = 1\nconst b = 2\n')
})

test('transpile removes types and keeps the export; a syntax error is not ok', () => {
  const r = transpile('const a: number = 1; export const b = a')
  expect(r.ok && r.js).not.toContain(': number')
  expect(r.ok && r.js).toContain('export const b')
  expect(transpile('const = ;').ok).toBe(false)
})

test('sharedBase is the origin plus the docs base without docs/, plus shared/', () => {
  expect(sharedBase('https://x.io', '/nano/docs/')).toBe('https://x.io/nano/shared/')
  expect(sharedBase('http://localhost:5173', '/docs/')).toBe('http://localhost:5173/shared/')
})

test('frameDoc has the import map, the run id, and survives </script> in code', () => {
  const doc = frameDoc('export const main = () => "</script><b>"', 'https://x.io/shared/', 'r1')
  expect(doc).toContain('"@pritzlaff/nano-core":"https://x.io/shared/nano-core.js"')
  expect(doc).toContain('"typebox":"https://x.io/shared/typebox.js"')
  expect(doc).toContain('"typebox/value":"https://x.io/shared/typebox-value.js"')
  expect(doc).toContain('"r1"')
  expect(doc).toContain('import failed')
  expect(doc.match(/<\/script>/g)?.length).toBe(3) // guard, import map, module: none from the reader's code
})

test('accept passes only the frame, the run, and a good shape', () => {
  const frame = {}
  const good = { run: 'r', kind: 'line', text: 'hi' }
  expect(accept({ source: frame, data: good }, frame, 'r')).toEqual({ kind: 'line', text: 'hi' })
  expect(accept({ source: {}, data: good }, frame, 'r')).toBeUndefined()
  expect(accept({ source: frame, data: { ...good, run: 'old' } }, frame, 'r')).toBeUndefined()
  expect(accept({ source: frame, data: { run: 'r', kind: 'nope' } }, frame, 'r')).toBeUndefined()
  expect(accept({ source: frame, data: 'x' }, frame, 'r')).toBeUndefined()
  expect(accept({ source: frame, data: { run: 'r', kind: 'done' } }, frame, 'r')).toEqual({ kind: 'done' })
})
