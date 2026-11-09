// A type's generated look: SHA-256 of its canonical definition picks its shape, colour and brand pattern.
import { PATTERNS, VMAX, bug, byIdOf, type TypeDef } from './constants'
import { centrePoint, clampPt } from './geometry'

const SHA_K = (() => {
  const primes: number[] = []
  for (let c = 2; primes.length < 64; c += 1) { if (primes.every(p => c % p !== 0)) primes.push(c) }
  return primes.map(p => (Math.pow(p, 1 / 3) % 1) * 4294967296 | 0)
})()
const SHA_H0 = [2, 3, 5, 7, 11, 13, 17, 19].map(p => (Math.pow(p, 1 / 2) % 1) * 4294967296 | 0)
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

/** SHA-256 of a string as hex (pure and synchronous, as in the prototype). */
export function sha256(text: string) {
  const bytes = Array.from(new TextEncoder().encode(text))
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  for (let i = 7; i >= 0; i -= 1) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff)
  let H = SHA_H0.slice()
  for (let off = 0; off < bytes.length; off += 64) {
    const w: number[] = new Array(64)
    for (let t = 0; t < 16; t += 1) w[t] = (bytes[off + 4 * t]! << 24) | (bytes[off + 4 * t + 1]! << 16) | (bytes[off + 4 * t + 2]! << 8) | bytes[off + 4 * t + 3]!
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15]!, 7) ^ rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3)
      const s1 = rotr(w[t - 2]!, 17) ^ rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10)
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) | 0
    }
    let [a, b, c, d, e, f, g, h] = H as [number, number, number, number, number, number, number, number]
    for (let t = 0; t < 64; t += 1) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[t]! + w[t]!) | 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    H = [H[0]! + a, H[1]! + b, H[2]! + c, H[3]! + d, H[4]! + e, H[5]! + f, H[6]! + g, H[7]! + h].map(x => x | 0)
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('')
}
const shaByte = (hex: string, i: number) => parseInt(hex.substr((i % 32) * 2, 2), 16) / 255
function shaShape(hex: string) {
  const b = (i: number) => shaByte(hex, i)
  const n = 6 + b(0) * 5
  const h = Math.min(26, n + 7 + b(1) * 9)
  const y1 = 5 + b(2) * 6
  const y2 = 12 + b(3) * 8
  const top = Math.min(VMAX, y2 + 10 + b(4) * 8)
  const o = (b(5) - 0.5) * 12
  const tilt = (b(6) - 0.5) * 10
  const sq = b(7) * 0.6
  const cx = 60 + o
  const shape = {
    start: [cx - n, 0] as [number, number],
    segs: [
      { c1: [cx - n, y1], c2: [cx - h, y1 * 0.8], p: [cx - h, y2] },
      { c1: clampPt([cx - h + h * sq, top + tilt]), c2: clampPt([cx + h - h * sq, top - tilt]), p: [cx + h, y2] },
      { c1: [cx + h, y1 * 0.8], c2: [cx + n, y1], p: [cx + n, 0] }
    ] as { c1: [number, number]; c2: [number, number]; p: [number, number] }[]
  }
  return { ...centrePoint(shape, 1), preset: 'sha' }
}
const shaColour = (hex: string) => 'hsl(' + Math.round(shaByte(hex, 8) * 360) + ', 62%, 68%)'
const shaPattern = (hex: string) => PATTERNS[1 + Math.floor(shaByte(hex, 9) * 4.999)]!.id

/** The text a type's SHA is taken over. */
export function canonicalDef(t: TypeDef, nameOf: (id: string) => string | undefined) {
  if (t.kind === 'record') return 'record ' + t.name + ' {' + t.fields!.map(f => f.name + ':' + nameOf(f.typeId) + (f.array ? '[]' : '')).join(';') + '}'
  if (t.kind === 'alias') return 'alias ' + t.name + ' = ' + nameOf(t.aliasFor!)
  return 'primitive ' + t.name
}
/** Recomputes each type's SHA, and the look of every type still generated from it (brands follow their source). */
export function refreshSha(types: TypeDef[]): TypeDef[] {
  const byId = byIdOf(types)
  const nameOf = (id: string) => { const t = byId[id]; if (t === undefined) bug('unknown type id ' + id); return t.name }
  const withSha = types.map(t => (t.builtIn ? t : { ...t, sha: sha256(canonicalDef(t, nameOf)) }))
  const records = withSha.map(t => (t.kind === 'record' && t.shapeSource === 'sha' ? { ...t, shape: shaShape(t.sha!), colour: shaColour(t.sha!) } : t))
  const resolve = (list: TypeDef[], depth: number): TypeDef[] => {
    if (depth > list.length + 1) return bug('brands refer to each other in a loop')
    const map = byIdOf(list)
    const next = list.map(t => (t.kind === 'alias' && t.shapeSource === 'sha' ? { ...t, shape: map[t.aliasFor!]!.shape, colour: map[t.aliasFor!]!.colour, pattern: shaPattern(t.sha!) } : t))
    const same = next.every((t, i) => t.shape === list[i]!.shape && t.colour === list[i]!.colour)
    return same ? next : resolve(next, depth + 1)
  }
  return resolve(records, 0)
}
