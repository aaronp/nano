import { nameOf, type EditorType, type TypeRef } from './types'

type Decl =
  | { name: string; line: number; kind: 'record'; fields: { name: string; ref: { name: string; array: boolean }; line: number }[] }
  | { name: string; line: number; kind: 'brand'; of: string }

export const printTypes = (types: EditorType[]): string => {
  const nameById = (id: string) => { const t = types.find(x => x.id === id); return t ? nameOf(t) : id }
  const out: string[] = []
  for (const t of types) {
    if (t.kind === 'brand') out.push(`type ${t.name} = ${nameById(t.of)}; // brand`, '')
    else if (t.kind === 'record') {
      out.push(`type ${t.name} = {`, ...t.fields.map(f => `  ${f.name}: ${nameById(f.ref.type)}${f.ref.array ? '[]' : ''};`), '}', '')
    }
  }
  return out.join('\n')
}

const blankComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length))
const lineAt = (s: string, i: number) => s.slice(0, i).split('\n').length

const typeExpr = (expr: string): { name: string; array: boolean } | null => {
  const e = expr.trim()
  const m = /^([A-Za-z_]\w*)\s*\[\s*\]$/.exec(e) ?? /^Array\s*<\s*([A-Za-z_]\w*)\s*>$/.exec(e)
  if (m) return { name: m[1]!, array: true }
  return /^[A-Za-z_]\w*$/.test(e) ? { name: e, array: false } : null
}

const parseDecls = (source: string, builtinNames: string[]): { decls: Decl[]; errors: string[] } => {
  const text = blankComments(source)
  const re = /(?:export\s+)?interface\s+([A-Za-z_]\w*)\s*\{([^{}]*)\}|(?:export\s+)?type\s+([A-Za-z_]\w*)\s*=\s*\{([^{}]*)\}\s*;?|(?:export\s+)?type\s+([A-Za-z_]\w*)\s*=\s*([^;{}\n]+?)\s*;?(?=\s*\n|\s*$)/g
  const decls: Decl[] = []
  const errors: string[] = []
  const unread = (from: number, gap: string) =>
    gap.trim() !== '' && errors.push(`Line ${lineAt(text, from + gap.search(/\S/))}: could not read "${gap.trim().split('\n')[0]!.slice(0, 40)}"`)
  let last = 0
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    unread(last, text.slice(last, m.index))
    const line = lineAt(text, m.index)
    const name = (m[1] ?? m[3] ?? m[5])!
    const body = m[2] ?? m[4]
    if (body !== undefined) {
      const bodyStart = m.index + m[0].indexOf('{') + 1
      const fields: Extract<Decl, { kind: 'record' }>['fields'] = []
      let cursor = 0
      for (const raw of body.split(/[;,\n]/)) {
        const at = body.indexOf(raw, cursor)
        cursor = at + raw.length
        const part = raw.trim()
        if (part === '') continue
        const fl = lineAt(text, bodyStart + at)
        const fm = /^([A-Za-z_]\w*)(\??)\s*:\s*(.+)$/.exec(part)
        if (!fm) { errors.push(`Line ${fl}: expected "name: Type", got "${part}"`); continue }
        const te = typeExpr(fm[3]!)
        if (!te) { errors.push(`Line ${fl}: ${fm[1]} — only a named type or T[] is supported, got "${fm[3]!.trim()}"`); continue }
        fields.push({ name: fm[1]!, ref: te, line: fl })
      }
      if (fields.length === 0) errors.push(`Line ${line}: ${name} has no fields`)
      decls.push({ name, line, kind: 'record', fields })
    } else {
      const te = typeExpr(m[6]!)
      if (!te) errors.push(`Line ${line}: ${name} — a brand must point at one named type, got "${m[6]!.trim()}"`)
      else if (te.array) errors.push(`Line ${line}: ${name} — a brand of an array is not supported yet; use a record field instead`)
      else decls.push({ name, line, kind: 'brand', of: te.name })
    }
    last = re.lastIndex
  }
  unread(last, text.slice(last))
  const seen = new Map<string, number>()
  for (const d of decls) {
    if (builtinNames.includes(d.name)) errors.push(`Line ${d.line}: ${d.name} is built in and cannot be redefined`)
    if (seen.has(d.name)) errors.push(`Line ${d.line}: ${d.name} is already defined on line ${seen.get(d.name)}`)
    seen.set(d.name, d.line)
  }
  const known = [...builtinNames, ...decls.map(d => d.name)]
  for (const d of decls) {
    if (d.kind === 'brand' && !known.includes(d.of)) errors.push(`Line ${d.line}: unknown type ${d.of}`)
    if (d.kind === 'record') for (const f of d.fields) if (!known.includes(f.ref.name)) errors.push(`Line ${f.line}: unknown type ${f.ref.name}`)
  }
  return { decls, errors }
}

export const parseTypes = (source: string, current: EditorType[], newId: () => string):
  { ok: true; types: EditorType[] } | { ok: false; errors: string[] } => {
  const prims = current.filter(t => t.kind === 'primitive')
  const { decls, errors } = parseDecls(source, prims.map(t => t.name))
  if (errors.length) return { ok: false, errors }
  const edited = current.filter(t => t.kind === 'record' || t.kind === 'brand')
  const old = new Map(edited.map(t => [t.name, t]))
  const idOf = new Map<string, string>(prims.map(t => [t.name, t.id]))
  for (const d of decls) idOf.set(d.name, old.get(d.name)?.id ?? newId())
  const build = (d: Decl): EditorType => {
    const prev = old.get(d.name)
    const base = { id: idOf.get(d.name)!, name: d.name, ...(prev?.look ? { look: prev.look } : {}) }
    return d.kind === 'brand'
      ? { ...base, kind: 'brand', of: idOf.get(d.of)! }
      : { ...base, kind: 'record', fields: d.fields.map(f => ({ name: f.name, ref: { type: idOf.get(f.ref.name)!, array: f.ref.array } satisfies TypeRef })) }
  }
  const byName = new Map(decls.map(d => [d.name, d]))
  const kept = current.flatMap(t => t.kind === 'record' || t.kind === 'brand' ? (byName.has(t.name) ? [build(byName.get(t.name)!)] : []) : [t])
  // a removed type can't still be used: every kept record/brand names its refs in the source, so unknown names already errored
  return { ok: true, types: [...kept, ...decls.filter(d => !old.has(d.name)).map(build)] }
}
