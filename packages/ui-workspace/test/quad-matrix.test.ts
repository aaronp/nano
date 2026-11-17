// A sandbox frame follows its placeholder's on-screen quad, tilted or not.
import { expect, test } from 'bun:test'
import { quadMatrix } from '../src/sandbox/sandboxed-view.ts'

const apply = (m: string, x: number, y: number) => {
  const v = m.slice(9, -1).split(',').map(Number)
  const X = v[0]! * x + v[4]! * y + v[12]!, Y = v[1]! * x + v[5]! * y + v[13]!, W = v[3]! * x + v[7]! * y + v[15]!
  return [X / W, Y / W].map(n => Math.round(n * 1000) / 1000)
}

test('quadMatrix maps the box corners onto the quad; a mirrored quad (the back) gives none', () => {
  const quad = [{ x: 10, y: 20 }, { x: 110, y: 30 }, { x: 100, y: 90 }, { x: 15, y: 70 }]
  const m = quadMatrix(200, 100, quad)!
  expect([apply(m, 0, 0), apply(m, 200, 0), apply(m, 200, 100), apply(m, 0, 100)]).toEqual(quad.map(p => [p.x, p.y]))
  expect(quadMatrix(200, 100, [quad[1]!, quad[0]!, quad[3]!, quad[2]!])).toBeUndefined()
})
