// The template imported from another origin (http://localhost:5174) in one Import click: the dialog shows where its
// providers come from and is the consent. Sandboxed (the default) lands its pods isolated-sandbox in acme.template.main;
// Trusted lands them host, their views defined, and a timer added from the picker counts its own ticks.
import { expect, test, type Page } from '@playwright/test'

const data = (page: Page) => page.evaluate(() => (document.querySelector('workspace-dock') as any).host.data())

async function importTemplate(page: Page, trust: 'Sandboxed' | 'Trusted') {
  await page.goto('/#/p/workspace')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.locator('workspace-dock#workspace nano-explorer')).toBeVisible()
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /^Open/ }).click()
  const d = page.getByRole('dialog', { name: 'Import components' })
  await d.getByLabel('nano.json URL').fill('http://localhost:5174/nano.json')
  await d.getByRole('button', { name: 'Fetch' }).click()
  await expect(d.getByLabel('Import runtime main as')).toHaveValue('acme.template.main')
  await expect(d.locator('.foreign')).toContainText('Code from http://localhost:5174 (acme.template)')
  await d.getByRole('radio', { name: new RegExp(`^${trust}`) }).check()
  await d.getByRole('button', { name: 'Import', exact: true }).click()   // the one click: no second confirm
  await expect(d).toHaveCount(0)
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  const got = await data(page)
  expect(got.runtimes['acme.template.main'].pods).toEqual(['timer', 'picker', 'store'])
  return got
}

test('the template from another origin, Sandboxed: its pods isolated-sandbox in acme.template.main, nothing asks', async ({ page }) => {
  const got = await importTemplate(page, 'Sandboxed')
  for (const p of ['timer', 'picker', 'store']) expect(got.pods[p].isolation).toBe('isolated-sandbox')
  const dock = page.locator('workspace-dock#workspace')
  await dock.locator('nano-explorer').getByText('timer', { exact: true }).first().dblclick()
  // its provider is never loaded into this page, so its view tag is not defined here: the panel is the sandboxed view
  await expect(dock.locator('nano-sandboxed').first()).toBeVisible()
  expect(await page.evaluate(() => !!customElements.get('nano-timer'))).toBe(false)
  await expect(page.locator('dialog[open]')).toHaveCount(0)
})

test('the template from another origin, Trusted: host pods, its view once approved, and a picked timer that counts', async ({ page }) => {
  const got = await importTemplate(page, 'Trusted')
  for (const p of ['timer', 'picker', 'store']) expect(got.pods[p].isolation ?? 'host').toBe('host')
  const dock = page.locator('workspace-dock#workspace')

  // (a) opening the timer's panel starts its pod, so its foreign code asks to run in this page; approved, the panel is
  // its own view, not the generic one
  await dock.locator('nano-explorer').getByText('timer', { exact: true }).first().dblclick()
  const ask = page.locator('dialog[open]').filter({ hasText: /Run acme\.template.* in this page\?/ })
  await ask.getByRole('button', { name: 'Approve' }).click()
  await expect(dock.locator('nano-timer').first()).toBeVisible()

  // (b) a timer from the picker's imported provider group (a panel header's +), with no pipes: Start, and it counts
  const before = await dock.locator('nano-timer').count()
  await dock.getByRole('button', { name: 'Add a panel' }).first().click()
  await page.locator('nano-picker [data-kind="provider"]:not([data-section="nano.ui"])').getByRole('button', { name: 'timer', exact: true }).click()
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
