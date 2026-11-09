// The Types "Code" view: print the types as TypeScript, read edited TypeScript back, and plan what applying it does.
import { byIdOf, bug, type Model, type TypeDef } from './constants'
import { presetShape } from './geometry'
import { canonicalDef, refreshSha } from './sha'

const BUILTIN_NAMES = ['string', 'number', 'boolean']

/** The user types as TypeScript source. */
export function modelToTs(types: TypeDef[]) {
  const byId = byIdOf(types)
  const lines = ['// Built-in: string, number, boolean', '']
  types.filter(t => !t.builtIn).forEach(t => {
    if (t.kind === 'alias') { lines.push('type ' + t.name + ' = ' + byId[t.aliasFor!]!.name + '; // brand'); lines.push(''); return }
    if (t.kind === 'record') {
      lines.push('interface ' + t.name + ' {')
      t.fields!.forEach(f => lines.push('  ' + f.name + ': ' + byId[f.typeId]!.name + (f.array ? '[]' : '') + ';'))
      lines.push('}')
      lines.push('')
      return
    }
    bug('cannot print kind ' + t.kind)
  })
  return lines.join('\n')
}
const blankComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length))
const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length
function parseTypeExpr(expr: string) {
  const e = expr.trim()
  const arr1 = /^([A-Za-z_]\w*)\s*\[\s*\]$/.exec(e)
  if (arr1) return { name: arr1[1]!, array: true }
  const arr2 = /^Array\s*<\s*([A-Za-z_]\w*)\s*>$/.exec(e)
  if (arr2) return { name: arr2[1]!, array: true }
  const one = /^([A-Za-z_]\w*)$/.exec(e)
  if (one) return { name: one[1]!, array: false }
  return null
}
type Decl = { name: string; line: number } & ({ kind: 'record'; fields: { name: string; typeName: string; array: boolean; line: number }[] } | { kind: 'alias'; aliasName: string })

/** Reads interfaces, object type literals and brands; anything else is a line-numbered error. */
export function parseTs(source: string) {
  const text = blankComments(source)
  const re = /(?:export\s+)?interface\s+([A-Za-z_]\w*)\s*\{([^{}]*)\}|(?:export\s+)?type\s+([A-Za-z_]\w*)\s*=\s*\{([^{}]*)\}\s*;?|(?:export\s+)?type\s+([A-Za-z_]\w*)\s*=\s*([^;{}\n]+?)\s*;?(?=\s*\n|\s*$)/g
  const decls: Decl[] = []
  const errors: string[] = []
  let last = 0
  let m = re.exec(text)
  while (m !== null) {
    const gap = text.slice(last, m.index)
    if (gap.trim() !== '') errors.push('Line ' + lineAt(text, last + gap.search(/\S/)) + ': could not read "' + gap.trim().split('\n')[0]!.slice(0, 40) + '"')
    const line = lineAt(text, m.index)
    const name = (m[1] || m[3] || m[5])!
    const body = m[2] !== undefined ? m[2] : m[4]
    if (body !== undefined) {
      const bodyStart = m.index + m[0].indexOf('{') + 1
      const fields: { name: string; typeName: string; array: boolean; line: number }[] = []
      let cursor = 0
      body.split(/[;,\n]/).forEach(raw => {
        const at = body.indexOf(raw, cursor)
        cursor = at + raw.length
        const part = raw.trim()
        if (part === '') return
        const fl = lineAt(text, bodyStart + at)
        const fm = /^([A-Za-z_]\w*)(\??)\s*:\s*(.+)$/.exec(part)
        if (fm === null) { errors.push('Line ' + fl + ': expected "name: Type", got "' + part + '"'); return }
        const te = parseTypeExpr(fm[3]!)
        if (te === null) { errors.push('Line ' + fl + ': ' + fm[1] + ' — only a named type or T[] is supported, got "' + fm[3]!.trim() + '"'); return }
        fields.push({ name: fm[1]!, typeName: te.name, array: te.array, line: fl })
      })
      if (fields.length === 0) errors.push('Line ' + line + ': ' + name + ' has no fields')
      decls.push({ name, kind: 'record', fields, line })
    } else {
      const te = parseTypeExpr(m[6]!)
      if (te === null) errors.push('Line ' + line + ': ' + name + ' — a brand must point at one named type, got "' + m[6]!.trim() + '"')
      else if (te.array) errors.push('Line ' + line + ': ' + name + ' — a brand of an array is not supported yet; use a record field instead')
      else decls.push({ name, kind: 'alias', aliasName: te.name, line })
    }
    last = re.lastIndex
    m = re.exec(text)
  }
  const tail = text.slice(last)
  if (tail.trim() !== '') errors.push('Line ' + lineAt(text, last + tail.search(/\S/)) + ': could not read "' + tail.trim().split('\n')[0]!.slice(0, 40) + '"')
  const seen: Record<string, number> = {}
  decls.forEach(d => {
    if (BUILTIN_NAMES.includes(d.name)) errors.push('Line ' + d.line + ': ' + d.name + ' is built in and cannot be redefined')
    if (seen[d.name] !== undefined) errors.push('Line ' + d.line + ': ' + d.name + ' is already defined on line ' + seen[d.name])
    seen[d.name] = d.line
  })
  const known = BUILTIN_NAMES.concat(decls.map(d => d.name))
  decls.forEach(d => {
    if (d.kind === 'alias' && !known.includes(d.aliasName)) errors.push('Line ' + d.line + ': unknown type ' + d.aliasName)
    if (d.kind === 'record') d.fields.forEach(f => { if (!known.includes(f.typeName)) errors.push('Line ' + f.line + ': unknown type ' + f.typeName) })
  })
  return { decls, errors }
}

/** What applying the source would do: errors, or a summary and the new model. */
export type Plan = { ok: false; errors: string[]; summary: string } | { ok: true; errors: string[]; summary: string; model: Model }
/** Plans applying edited TypeScript to the model; removing a type an action uses is refused. */
export function planTs(model: Model, source: string): Plan {
  const parsed = parseTs(source)
  if (parsed.errors.length > 0) return { ok: false, errors: parsed.errors, summary: '' }
  const existing = model.types.filter(t => !t.builtIn)
  const byName = Object.fromEntries(existing.map(t => [t.name, t]))
  let nextId = model.nextId
  const idOf: Record<string, string> = Object.fromEntries(model.types.filter(t => t.builtIn).map(t => [t.name, t.id]))
  parsed.decls.forEach(d => { idOf[d.name] = byName[d.name] !== undefined ? byName[d.name]!.id : 't' + (nextId++) })
  const built = parsed.decls.map((d): TypeDef => {
    const prev = byName[d.name]
    const base: TypeDef = prev !== undefined ? prev : { id: idOf[d.name]!, name: d.name, kind: d.kind, builtIn: false, shapeSource: 'sha', shape: presetShape('dome'), colour: '#B0B8C8', pattern: 'none' }
    const core: TypeDef = { ...base, kind: d.kind }
    delete core.fields
    delete core.aliasFor
    return d.kind === 'record'
      ? { ...core, fields: d.fields.map(f => ({ name: f.name, typeId: idOf[f.typeName]!, array: f.array })) }
      : { ...core, aliasFor: idOf[d.aliasName] }
  })
  const removed = existing.filter(t => !parsed.decls.some(d => d.name === t.name))
  const errors = removed.reduce((acc: string[], t) => {
    const used = model.actions.filter(a => (a.input !== null && a.input.typeId === t.id) || (a.output !== null && a.output.typeId === t.id)).map(a => a.name)
    return used.length === 0 ? acc : acc.concat(['Cannot remove ' + t.name + ': used by action ' + used.join(', ')])
  }, [])
  if (errors.length > 0) return { ok: false, errors, summary: '' }
  const types = refreshSha(model.types.filter(t => t.builtIn).concat(built))
  const oldMap = Object.fromEntries(model.types.map(t => [t.id, t.name]))
  const oldDefs = Object.fromEntries(existing.map(t => [t.name, canonicalDef(t, id => oldMap[id])]))
  const newMap = Object.fromEntries(types.map(t => [t.id, t.name]))
  const added = built.filter(t => byName[t.name] === undefined).map(t => t.name)
  const changed = types.filter(t => !t.builtIn && byName[t.name] !== undefined && oldDefs[t.name] !== canonicalDef(t, id => newMap[id])).map(t => t.name)
  const parts: string[] = []
  if (added.length > 0) parts.push('adds ' + added.join(', '))
  if (changed.length > 0) parts.push('changes ' + changed.join(', '))
  if (removed.length > 0) parts.push('removes ' + removed.map(t => t.name).join(', '))
  return { ok: true, errors: [], summary: parts.length === 0 ? 'No changes' : parts.join(' · '), model: { ...model, types, nextId } }
}
