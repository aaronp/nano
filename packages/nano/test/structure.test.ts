// Guardrails (spec: "Guardrails: keeping the model small"). Keeps the model small mechanically:
// - no source file (every package's src, and the example sources) over MAX_LINES; no exported interface / object type over MAX_MEMBERS;
// - every exported name of packages/nano appears in design.md (in backticks), so a new concept needs a visible design change.
// Existing offenders live in structure-baseline.json, which may only shrink: a listed item may not grow,
// a new offender fails, and an item back within the limit must be removed from the baseline.
// Regenerate the baseline (only when the user agrees to the new numbers): NANO_BASELINE=1 bun test test/structure.test.ts
import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const MAX_LINES = 150
const MAX_MEMBERS = 10
const pkg = join(import.meta.dir, '..')
const root = join(pkg, '..', '..')   // the repo; baseline keys are paths relative to it
const nanoSrc = join(pkg, 'src')
const covered = [...readdirSync(join(root, 'packages')).map(p => join(root, 'packages', p, 'src')).filter(existsSync), join(root, 'examples')]
const baselinePath = join(pkg, 'structure-baseline.json')
const design = readFileSync(join(root, 'design.md'), 'utf8')

type Baseline = { lines: Record<string, number>; members: Record<string, number>; undocumented: string[] }

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (['dist', 'node_modules', 'public', 'generated'].includes(e.name) ? [] : files(join(dir, e.name))) : e.name.endsWith('.ts') && !/\.(test|d)\.ts$/.test(e.name) ? [join(dir, e.name)] : [])

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

/** Members of the `{ … }` body starting at `open` (a `{`): top-level segments that start a property, method or index. */
const membersAt = (text: string, open: number): number => {
  let depth = 0, i = open, body = ''
  for (; i < text.length; i++) {
    const c = text[i]!
    if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < text.length && text[i] !== q) i += text[i] === '\\' ? 2 : 1; if (depth === 1) body += 'S'; continue }
    if ('{(['.includes(c)) { depth++; if (depth === 2) body += c; continue }
    if ('})]'.includes(c)) { depth--; if (depth === 0) break; if (depth === 1) body += c; continue }
    if (depth === 1) body += c
  }
  return body.split(/[;\n,]/).filter(seg => /^\s*(readonly\s+)?([A-Za-z_$][\w$]*\??\s*[:(<]|\[|\()/.test(seg)).length
}

const measure = () => {
  const lines: Record<string, number> = {}, members: Record<string, number> = {}, exported = new Set<string>()
  for (const f of covered.flatMap(files)) {
    const raw = readFileSync(f, 'utf8'), rel = relative(root, f), text = stripComments(raw)
    const n = raw.split('\n').length - (raw.endsWith('\n') ? 1 : 0)
    if (n > MAX_LINES) lines[rel] = n
    if (f.startsWith(nanoSrc)) for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:const|function|type|interface|class)\s+([A-Za-z_$][\w$]*)/gm)) exported.add(m[1]!)
    for (const m of text.matchAll(/^export\s+(?:interface\s+([A-Za-z_$][\w$]*)[^{]*|type\s+([A-Za-z_$][\w$]*)(?:<[^=]*>)?\s*=\s*(?:[\w$.<>, ]+&\s*)?)\{/gm)) {
      const count = membersAt(text, m.index! + m[0].length - 1)
      if (count > MAX_MEMBERS) members[`${rel}:${m[1] ?? m[2]}`] = count
    }
  }
  const undocumented = [...exported].filter(name => !design.includes('`' + name + '`') && !design.includes('`' + name + '(') && !design.includes('`' + name + '.')).sort()
  return { lines, members, undocumented }
}

const now = measure()
if (process.env.NANO_BASELINE) writeFileSync(baselinePath, JSON.stringify(now, null, 2) + '\n')
const base: Baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))

const over = (actual: Record<string, number>, allowed: Record<string, number>, limit: number) => [
  ...Object.entries(actual).filter(([k, v]) => v > (allowed[k] ?? limit)).map(([k, v]) => `${k}: ${v} (allowed ${allowed[k] ?? limit})`),
  ...Object.entries(allowed).filter(([k]) => !(k in actual)).map(([k]) => `${k}: now within ${limit}; remove it from the baseline`),
]

describe('guardrails', () => {
  test(`no source file grows past ${MAX_LINES} lines (or past its baseline)`, () => {
    expect(over(now.lines, base.lines, MAX_LINES)).toEqual([])
  })
  test(`no exported interface or object type grows past ${MAX_MEMBERS} members (or past its baseline)`, () => {
    expect(over(now.members, base.members, MAX_MEMBERS)).toEqual([])
  })
  test('every exported name is in design.md, apart from the shrinking baseline', () => {
    const allowed = new Set(base.undocumented)
    expect({
      newlyUndocumented: now.undocumented.filter(n => !allowed.has(n)),
      nowDocumentedOrGone: base.undocumented.filter(n => !now.undocumented.includes(n)),
    }).toEqual({ newlyUndocumented: [], nowDocumentedOrGone: [] })
  })
  test('the member counter counts properties, methods and indexes, not nested ones', () => {
    const t = 'export type T = {\n  a: number\n  readonly b?: { x: 1; y: 2 }\n  c(x: string): void; d: (y: { z: 1 }) => void\n  [k: string]: unknown\n}'
    expect(membersAt(t, t.indexOf('{'))).toBe(5)
  })
})
