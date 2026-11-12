import { expect, test } from 'bun:test'
import type { Component } from '@pritzlaff/nano-core'
import { parseRef, ref, type AppCatalog } from '../src'

test('refs round-trip', () => {
  expect(parseRef(ref.instance('lab', 'r1'))).toEqual({ kind: 'instance', system: 'lab', id: 'r1' })
  expect(parseRef(ref.system('lab'))).toEqual({ kind: 'system', id: 'lab' })
  expect(parseRef(ref.screen('/lab/one'))).toEqual({ kind: 'screen', path: '/lab/one' })
})

test('malformed refs parse to null', () => {
  for (const s of ['x', 'instance:lab', 'instance:Lab/r1', 'screen:lab', 'system:', 'screen:/']) {
    expect(parseRef(s)).toBeNull()
  }
})

test('building a bad ref throws', () => {
  expect(() => ref.system('Bad')).toThrow()
  expect(() => ref.screen('lab')).toThrow()
})

test('a structurally matching catalog is an AppCatalog', () => {
  // same shape as nano-elements' Catalog (title required there, optional here)
  const elements: Record<string, { component: Component; title: string; tag?: string }> = {
    counter: { component: {} as Component, title: 'Counter', tag: 'demo' },
  }
  const app: AppCatalog = elements
  expect(Object.keys(app)).toEqual(['counter'])
})
