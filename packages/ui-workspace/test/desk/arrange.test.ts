import { expect, test } from 'bun:test'
import { align, arrange, columnSize, GRID, prune, push, readLayout, setSnap, type DeskLayout, type Sized } from '../../src/desk/arrange.ts'
import type { Column, DeskModel } from '../../src/desk/model.ts'

const col = (runtime: string, pod: string, ins = ['p a/go:in'], outs = ['p a/done:out']): Column => ({ runtime, pod, implementation: 'I', ins, outs })
const model = (runtimes: Record<string, string[]>, rank: Record<string, number>): DeskModel => ({
  runtimes: Object.entries(runtimes).map(([id, pods]) => ({ id, columns: pods.map(p => col(id, p)) })),
  pipes: [], calls: [], rank, wires: {} as never,
})
const base = (): DeskLayout => ({ snap: true, compact: false, runtimes: {}, pods: {} })
const apart = (a: Sized, b: Sized) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
const noOverlap = (bs: Sized[]) => bs.every((a, i) => bs.every((b, j) => i >= j || apart(a, b)))
const rooms = () => model({ room: ['alice'], backend: ['store'] }, { room: 0, backend: 1 })

test('readLayout of junk is the default', () => {
  for (const j of [undefined, 42, { snap: 'x' }]) expect(readLayout(j)).toEqual(base())
})

test('B places callers left', () => {
  const { runtimes: r } = arrange(rooms(), base())
  expect(r.backend!.x).toBeGreaterThan(r.room!.x + r.room!.w)
})

test('runtimes in one rank stack', () => {
  const { runtimes: r } = arrange(model({ a: ['p'], b: ['q'] }, { a: 0, b: 0 }), base())
  expect(r.a!.x).toBe(r.b!.x)
  expect(noOverlap([r.a!, r.b!])).toBe(true)
})

test('a runtime holds its columns', () => {
  const m = model({ a: ['p', 'q', 'r'] }, { a: 0 })
  const { runtimes, columns } = arrange(m, base())
  for (const c of Object.values(columns.a!)) {
    expect(c.x + c.w).toBeLessThanOrEqual(runtimes.a!.w)
    expect(c.y + c.h).toBeLessThanOrEqual(runtimes.a!.h)
  }
})

test('saved positions are kept, hidden ones too; prune drops only what is no longer placed', () => {
  const l = { ...base(), runtimes: { main: { x: 0, y: 0 }, old: { x: 9, y: 9 } }, pods: { main: { r: { x: 400, y: 40 }, hidden: { x: 600, y: 40 }, gone: { x: 20, y: 40 } }, old: { q: { x: 1, y: 1 } } } }
  const { layout, columns } = arrange(model({ main: ['r', 'd'] }, { main: 0 }), l)
  expect(columns.main!.r).toMatchObject({ x: 400, y: 40 })
  expect(layout.pods.main!.hidden).toEqual({ x: 600, y: 40 })
  const p = prune(layout, new Map([['main', new Set(['r', 'd', 'hidden'])]]))
  expect(Object.keys(p.pods.main!).sort()).toEqual(['d', 'hidden', 'r'])
  expect(p.pods.old).toBeUndefined()
  expect(p.runtimes.old).toBeUndefined()
})

test("a new pod doesn't overlap saved ones", () => {
  const l = { ...base(), pods: { main: { a: { x: 20, y: 40 }, b: { x: 300, y: 40 } } } }
  const { columns } = arrange(model({ main: ['a', 'b', 'c'] }, { main: 0 }), l)
  expect(noOverlap(Object.values(columns.main!))).toBe(true)
})

const box = (x: number, y: number, w = 100, h = 60): Sized => ({ x, y, w, h })

test('push moves an overlapped box right or down and cascades', () => {
  const boxes = { a: box(0, 0), b: box(50, 0), c: box(180, 0) }
  const moved = push(boxes, 'a', false)
  const all = { ...boxes, ...Object.fromEntries(Object.entries(moved).map(([k, p]) => [k, { ...boxes[k as 'b'], ...p }])) }
  expect(moved.a).toBeUndefined()
  expect(noOverlap(Object.values(all))).toBe(true)
})

test('push terminates on a self-overlapping set', () => {
  const boxes = { a: box(0, 0), b: box(10, 10), c: box(20, 5), d: box(5, 20) }
  const moved = push(boxes, 'a', true)
  const all = Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, { ...b, ...moved[k] }]))
  expect(noOverlap(Object.values(all))).toBe(true)
})

test('setSnap on rounds, off keeps', () => {
  const l: DeskLayout = { snap: false, compact: false, runtimes: { r: { x: 33, y: 47 } }, pods: { r: { p: { x: 33, y: 47 } } } }
  const on = setSnap(l, true)
  expect(on.runtimes.r).toEqual({ x: 40, y: 40 })
  expect(on.pods.r!.p).toEqual({ x: 40, y: 40 })
  expect(setSnap({ ...l, snap: true }, false).runtimes.r).toEqual({ x: 33, y: 47 })
  expect(GRID).toBe(20)
})

test('align clears positions, keeps settings', () => {
  const l: DeskLayout = { snap: false, compact: true, runtimes: { r: { x: 1, y: 2 } }, pods: { r: { p: { x: 1, y: 2 } } } }
  expect(align(rooms(), l)).toEqual({ snap: false, compact: true, runtimes: {}, pods: {} })
})

test('compact columns are narrower', () => {
  const c = col('r', 'p')
  expect(columnSize(c, true).w).toBeLessThan(columnSize(c, false).w)
})

const settle = (boxes: Record<string, Sized>, placed: string, snap: boolean) => {
  const moved = push(boxes, placed, snap)
  return Object.entries(boxes).map(([k, b]) => ({ ...b, ...moved[k] }))
}

test('push never lands a box on the placed one', () => {
  // fuzz-found: b2 is pushed onto b1's way and the cascade lands a box back on the placed one
  const all = settle({ b0: { x: 60, y: 0, w: 80, h: 80 }, b1: { x: 0, y: 40, w: 40, h: 80 }, b2: { x: 40, y: 0, w: 40, h: 40 } }, 'b0', false)
  expect(noOverlap(all)).toBe(true)
})

test('push leaves no overlap on seeded random sets', () => {
  let s = 7
  const rnd = (n: number) => (s = (s * 1103515245 + 12345) % 2147483648) % n
  for (let i = 0; i < 1000; i++) {
    const boxes: Record<string, Sized> = {}
    boxes.b0 = box(rnd(300), rnd(300), 40 + rnd(100), 40 + rnd(100)) // dropped anywhere
    for (let j = 1, n = 1 + rnd(5); j <= n; j++) boxes['b' + j] = box((j % 3) * 160, Math.floor(j / 3) * 160, 40 + rnd(100), 40 + rnd(100)) // others start apart
    const snap = i % 2 === 0
    expect(noOverlap(settle(boxes, 'b0', snap))).toBe(true)
  }
})

test('a new runtime is not placed on a dragged saved one', () => {
  const m = model({ a: ['p'], b: ['q'] }, { a: 0, b: 0 })
  const free = arrange(m, base()).runtimes
  const l = { ...base(), runtimes: { a: { x: free.b!.x, y: free.b!.y } } }
  const { runtimes } = arrange(m, l)
  expect(noOverlap([runtimes.a!, runtimes.b!])).toBe(true)
  expect(runtimes.a).toMatchObject(l.runtimes.a)
})
