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
  // The example's own pods must appear (host pods are always there). A pod from another origin may ask to be approved: click Approve while waiting.
  const want = Object.keys((await (await page.request.get(`/${src}`)).json()).pods)
  await expect.poll(async () => {
    const a = page.locator('dialog[open]').getByRole('button', { name: 'Approve' })
    if (await a.count()) await a.first().click()
    const pods = await page.evaluate(() => Object.keys((document.querySelector('workspace-dock') as any).host.data().pods))
    return want.filter(n => !pods.includes(n))
  }, { timeout: 30_000 }).toEqual([])
  // main.ts drops it once the import succeeded: after any eager pod is built (originkey's frame loads first), so wait for it
  await expect.poll(() => new URL(page.url()).searchParams.has('src'), { timeout: 15_000 }).toBe(false)
  await expect(page.locator('.toast.bad')).toHaveCount(0)
})
