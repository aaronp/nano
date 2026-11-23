import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '../docs-site'), SKIP = new Set(['node_modules', 'cache', 'dist'])
const pages = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  SKIP.has(e.name) ? [] : e.isDirectory() ? pages(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : [])
const srcs = [...new Set(pages(root).flatMap(p => [...readFileSync(p, 'utf8').matchAll(/<OpenInNano\s+src="([^"]+)"/g)].map(m => m[1]!)))]

for (const src of srcs) test(`Open in nano: ${src} imports and adds pods`, async ({ page }) => {
  await page.goto('/#/p/workspace')
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/?src=${src}#/p/workspace`)
  // ?src= imports at once (no dialog); a trusted pod from another origin would ask to be approved
  for (let i = 0; i < 4; i++) { const a = page.locator('dialog[open]').getByRole('button', { name: 'Approve' }); if (await a.count()) await a.first().click(); else await page.waitForTimeout(300) }
  await expect.poll(() => page.evaluate(() => Object.keys((document.querySelector('workspace-dock') as any).host.data().pods).length)).toBeGreaterThan(0)
  await expect(page.locator('.toast.bad')).toHaveCount(0)
})
