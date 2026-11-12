// The inbox package, imported (the host has no Inbox of its own): folders, list and reader wired by events, then used.
import { expect, test, type Page } from '@playwright/test'

const MANIFEST = 'http://localhost:5211/manifest.json'   // playwright.config.ts serves the inbox package here
const SELECTED = 'nano.inbox/folders/selected', SHOW = 'nano.inbox/list/show'
const OPENED = 'nano.inbox/list/opened', READ = 'nano.inbox/reader/read'

const platform = (page: Page) => page.locator('section.panel c-platform')

async function connect(page: Page, source: string, event: string, listener: string, op: string) {
  const p = platform(page)
  for (const id of [source, listener]) {
    const row = p.locator(`li[role="treeitem"][data-id="c:host/${id}"]`).first()
    if (await row.getAttribute('aria-expanded') === 'false') await p.locator(`.chev[data-toggle="c:host/${id}"]`).first().click()
  }
  const line = p.locator(`[role="treeitem"][data-id="o:host/${source}/${event}"] .line`).first()
  await line.click()
  await p.locator(`[data-connect="host/${listener}/${op}"]`).click()
  await line.click()   // unselect
}

test('importing the inbox package, wiring folders → list → reader, then choosing Sent and opening a message shows it in the reader', async ({ page }) => {
  await page.goto('/#/workspace')
  await page.locator('[data-import-open]').first().click()
  const dialog = page.getByRole('dialog', { name: 'Import components' })
  await dialog.getByLabel('Manifest URL').fill(MANIFEST)
  await dialog.locator('[data-fetch]').click()
  await dialog.locator('input[name="trust"][value="trusted"]').check()
  await dialog.locator('[data-import]').click()
  await expect(dialog).toBeHidden()

  await page.goto('/#/systems')
  const p = platform(page)
  for (const kind of ['folders', 'list', 'reader']) {
    await p.getByRole('button', { name: '+ Add' }).click()
    await p.locator('select[name="kind"]').selectOption(kind)
    await p.locator('input[name="name"]').fill(kind)
    await p.getByRole('button', { name: 'Create' }).click()
  }
  await connect(page, 'folders', SELECTED, 'list', SHOW)
  await connect(page, 'list', OPENED, 'reader', READ)

  await page.goto('/#/workspace')
  for (const name of ['folders', 'list', 'reader'])
    await page.evaluate(n => document.dispatchEvent(new CustomEvent('wires:open-panel', { detail: { kind: n, name: n }, bubbles: true })), name)
  const dock = page.locator('workspace-dock')
  const show = (title: string) => dock.locator('.lm_tab').getByText(title, { exact: true }).first().click()

  await show('folders')
  await dock.locator('inbox-folders button', { hasText: 'Sent' }).click()
  await show('list')
  await dock.locator('inbox-list button', { hasText: 'Re: Quarterly plan' }).click()
  await show('reader')
  await expect(dock.locator('inbox-reader h2')).toHaveText('Re: Quarterly plan')
})
