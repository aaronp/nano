// The page is named Nano and has a favicon.
import { expect, test } from 'bun:test'

test('the page is called Nano, with an SVG favicon', async () => {
  const page = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  expect(page).toContain('<title>Nano</title>')
  expect(page).toContain('<span slot="title">Nano</span>')
  expect(page).not.toMatch(/\[App name\]|\[Company\]/)
  expect(page).toContain('<link rel="icon" href="./favicon.svg" type="image/svg+xml">')
  expect(await Bun.file(new URL('../public/favicon.svg', import.meta.url)).text()).toStartWith('<svg')
})
