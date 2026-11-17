import { expect, test } from 'bun:test'
import { newerCore } from '../src/built.ts'

const by = (v: string) => ({ '@pritzlaff/nano-core': v })

test('a module built with a newer nano-core is warned about', () => {
  expect(newerCore('acme.x', by('0.5.0'), '0.4.2')).toBe('acme.x was built with nano-core 0.5.0; this workspace has 0.4.2')
  expect(newerCore('acme.x', by('1.0.0'), '0.9.9')).toBe('acme.x was built with nano-core 1.0.0; this workspace has 0.9.9')
})

test('the same, an older or a patch-newer nano-core, or no stamp, is not', () => {
  for (const v of ['0.4.0', '0.4.9', '0.3.7']) expect(newerCore('acme.x', by(v), '0.4.0')).toBeUndefined()
  expect(newerCore('acme.x', undefined, '0.4.0')).toBeUndefined()
  expect(newerCore('acme.x', {}, '0.4.0')).toBeUndefined()
})

test('a malformed stamp never throws and never warns: not a string, not semver, or too long', () => {
  for (const bad of [5, {}, [], null, 'v0.9.0', '9.0.0<b>x</b>', '9.0.0' + 'x'.repeat(100_000)])
    expect(newerCore('acme.x', { '@pritzlaff/nano-core': bad } as never, '0.4.0')).toBeUndefined()
})
