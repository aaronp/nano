import { expect, test } from 'bun:test'
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { linkLocal } from './link-local'

// a fake repo with the three packages and a template whose @pritzlaff copies are real directories, plus lit beside them
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'link-local-'))), repo = join(root, 'repo'), dir = join(root, 'templates', 't')
  for (const p of ['core', 'runes', 'elements']) mkdirSync(join(repo, 'packages', p), { recursive: true })
  const scope = join(dir, 'node_modules', '@pritzlaff')
  mkdirSync(join(scope, 'nano-core'), { recursive: true }); writeFileSync(join(scope, 'nano-core', 'x.js'), '')
  mkdirSync(join(scope, 'nano-runes'), { recursive: true })
  symlinkSync('/nowhere', join(scope, 'nano-elements'))   // an existing (stale) link is replaced too
  mkdirSync(join(scope, 'other')); mkdirSync(join(dir, 'node_modules', 'lit'), { recursive: true })
  return { repo, dir, scope }
}

test('links node_modules/@pritzlaff/nano-{core,runes,elements} to packages/{core,runes,elements}', () => {
  const { repo, dir, scope } = fixture()
  const made = linkLocal(dir, repo)
  expect(made.length).toBe(3)
  for (const p of ['core', 'runes', 'elements']) {
    expect(lstatSync(join(scope, `nano-${p}`)).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(scope, `nano-${p}`))).toStartWith('..')   // relative
    expect(realpathSync(join(scope, `nano-${p}`))).toBe(join(repo, 'packages', p))
  }
})

test('running it twice changes nothing', () => {
  const { repo, dir, scope } = fixture()
  linkLocal(dir, repo)
  const targets = () => readdirSync(scope).sort().map(n => lstatSync(join(scope, n)).isSymbolicLink() ? readlinkSync(join(scope, n)) : n)
  const first = targets()
  expect(linkLocal(dir, repo).length).toBe(3)
  expect(targets()).toEqual(first)
})

test('touches nothing else in node_modules', () => {
  const { repo, dir, scope } = fixture()
  linkLocal(dir, repo)
  expect(readdirSync(scope).sort()).toEqual(['nano-core', 'nano-elements', 'nano-runes', 'other'])
  expect(lstatSync(join(scope, 'other')).isDirectory()).toBe(true)
  expect(lstatSync(join(dir, 'node_modules', 'lit')).isDirectory()).toBe(true)
})
