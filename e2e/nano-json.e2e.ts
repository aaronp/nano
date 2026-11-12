// A nano.json document: opened by ?src= (with the trusted import ticked in the confirmation), then downloaded and opened back.
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const SRC = 'http://localhost:3210/demo.nano.json'   // served below from e2e/fixtures; the host's own origin
const INFO = 'composable.bundle/log/info'
const platform = (page: Page) => page.locator('section.panel c-platform')
const navOrder = (page: Page) => page.locator('app-shell > a[data-saved]').evaluateAll(as => as.map(a => (a as HTMLElement).dataset.saved))

async function serveFixture(page: Page) {
  const body = readFileSync('e2e/fixtures/demo.nano.json', 'utf8')
  await page.route('**/demo.nano.json', r => r.fulfill({ contentType: 'application/json', body }))
}

/** ?src=: the confirmation (tick the trusted import, Continue), then the page reloads with the app. */
async function openBySrc(page: Page) {
  await serveFixture(page)
  await page.goto(`/?src=${encodeURIComponent(SRC)}`)
  const confirm = page.getByRole('dialog', { name: 'Confirm what to load' })
  await confirm.locator('input[data-import="0"]').check()
  await confirm.locator('[data-ok]').click()
  await expect(page.locator('app-shell > a[data-saved]')).toHaveCount(2)   // the reloaded app's saved workspaces are in the nav
}

/** The app's shape on the Systems page: instances (with their deploy mode), the wiring, the workspaces in nav order. */
async function expectDemo(page: Page) {
  await page.goto('/#/systems')
  const p = platform(page)
  for (const id of ['p1', 'L']) await expect(p.locator(`li[role="treeitem"][data-id="c:host/${id}"]`).first()).toBeVisible()
  await expect(page.locator('section.panel c-platform-table tr[data-deploy="isolated-sandbox"]').filter({ hasText: 'p1' })).toHaveCount(1)
  await expect(p.locator('[role="treeitem"][data-id^="x:host/"]').filter({ hasText: `→ L · ${INFO}` })).toHaveCount(1)
  expect(await navOrder(page)).toEqual(['/zeta', '/alpha'])
}

test('?src= opens a nano.json: confirm the import, and picking in its picker logs in its log', async ({ page }) => {
  await openBySrc(page)
  await expectDemo(page)
  await page.goto('/#/workspace')
  for (const [kind, name] of [['picker', 'p1'], ['log', 'L']])
    await page.evaluate(([kind, name]) => document.dispatchEvent(new CustomEvent('wires:open-panel', { detail: { kind, name }, bubbles: true })), [kind, name])
  const dock = page.locator('workspace-dock')
  await dock.locator('.lm_tab').getByText('p1', { exact: true }).first().click()
  // an isolated sandbox: pick by keyboard (the list can extend past the iframe)
  const frame = page.frameLocator('iframe[sandbox="allow-scripts"]').first()
  await frame.locator('nano-picker [role="combobox"]').first().click()
  const search = frame.locator('nano-picker input[role="combobox"]').first()
  await search.fill('fast')
  await search.press('Enter')
  await dock.locator('.lm_tab').getByText('L', { exact: true }).first().click()
  await expect(dock.locator('c-log[name="L"]')).toContainText('"fast"')
})

test('Download then Open the file restores the same app: instances, wiring and workspace order', async ({ page }, testInfo) => {
  await openBySrc(page)
  const menu = page.locator('nano-file-menu')
  const run = async (label: string) => { await menu.getByRole('button', { name: 'File', exact: true }).click(); await menu.getByRole('button', { name: label, exact: true }).click() }

  const [download] = await Promise.all([page.waitForEvent('download'), run('Download')])
  const file = testInfo.outputPath('demo.json')
  await download.saveAs(file)

  // New: the app is empty (it may first ask to replace unsaved changes)
  await run('New')
  await page.getByRole('dialog', { name: 'Confirm', exact: true }).locator('[data-ok]').click({ timeout: 2000 }).catch(() => {})
  await expect(page.locator('app-shell > a[data-saved]')).toHaveCount(0)
  await page.goto('/#/systems')
  await expect(platform(page).locator('li[role="treeitem"][data-id="c:host/p1"]')).toHaveCount(0)

  // Open the downloaded file; its import is confirmed again
  await run('Open…')
  await page.getByRole('dialog', { name: 'Confirm', exact: true }).locator('[data-ok]').click({ timeout: 2000 }).catch(() => {})
  const open = page.getByRole('dialog', { name: 'Open an app' })
  await open.locator('input[type="file"]').setInputFiles(file)
  const confirm = page.getByRole('dialog', { name: 'Confirm what to load' })
  await confirm.locator('input[data-import="0"]').check()
  await confirm.locator('[data-ok]').click()
  await expect(page.locator('app-shell > a[data-saved]')).toHaveCount(2)
  await expectDemo(page)
})
