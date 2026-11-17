// The template imported from another origin (http://localhost:5174): its views are defined once the import is
// confirmed, and a timer added from the drawer counts its own ticks.
import { expect, test } from '@playwright/test'

test('the template from another origin: its view before anything ran, and a drawer timer that counts', async ({ page }) => {
  await page.goto('/#/workspace')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  const dock = page.locator('workspace-dock#workspace')
  await expect(dock.locator('nano-explorer')).toBeVisible()

  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /^Open/ }).click()
  const d = page.getByRole('dialog', { name: 'Import components' })
  await d.getByLabel('nano.json URL').fill('http://localhost:5174/nano.json')
  await d.getByRole('button', { name: 'Fetch' }).click()
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await page.getByRole('dialog', { name: 'Confirm the import' }).getByRole('button', { name: 'Import' }).click()
  await expect(d).toHaveCount(0)

  // (a) the imported timer's panel is its own view, not the generic one, before any of its pods built
  await dock.locator('nano-explorer').getByText('timer', { exact: true }).first().click()
  await expect(dock.locator('nano-timer').first()).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(0)   // nothing asked to run yet

  // (b) a timer from the drawer's Imported section, with no pipes: Start, and it counts
  const before = await dock.locator('nano-timer').count()
  await page.locator('component-drawer').getByRole('link', { name: 'timer', exact: true }).click()
  const approve = async () => {   // running it in this page asks first
    const yes = page.locator('dialog[open]').getByRole('button', { name: 'Approve' })
    while (await yes.isVisible().catch(() => false) || await yes.waitFor({ timeout: 1000 }).then(() => true, () => false)) await yes.click()
  }
  await approve()
  await expect(dock.locator('nano-timer')).toHaveCount(before + 1)
  const view = dock.locator('nano-timer').last()
  await view.getByRole('button', { name: 'Start' }).click()
  await approve()
  await expect.poll(async () => Number(await view.getByLabel('ticks seen').textContent()), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
})
