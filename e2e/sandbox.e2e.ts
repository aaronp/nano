// One imported package in three deploy modes, all wired to one log: host, sandbox (same-origin iframe) and
// isolated-sandbox (opaque-origin iframe) must behave the same to their neighbours, and differ only in what they reach.
import { expect, test, type Frame, type FrameLocator, type Locator, type Page } from '@playwright/test'

const MANIFEST = 'http://localhost:5174/manifest.json'
const MODES = { 'p-host': 'host', 'p-sbx': 'sandbox', 'p-iso': 'isolated-sandbox' } as const
const CHANGED = 'nano.template/picker/changed', INFO = 'composable.bundle/log/info'

const platform = (page: Page) => page.locator('section.panel c-platform')
const table = (page: Page) => page.locator('section.panel c-platform-table')

async function importTemplate(page: Page, trust: 'trusted' | 'sandboxed') {
  await page.getByRole('button', { name: 'Import', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Import components' })
  await dialog.getByLabel('Manifest URL').fill(MANIFEST)
  await dialog.locator('[data-fetch]').click()
  await dialog.locator(`input[name="trust"][value="${trust}"]`).check()
  await dialog.locator('[data-import]').click()
  await expect(dialog).toBeHidden()
}

async function add(page: Page, kind: string, name: string, mode?: string) {
  const p = platform(page)
  await p.getByRole('button', { name: '+ Add' }).click()
  await p.locator('select[name="kind"]').selectOption(kind)
  await p.locator('input[name="name"]').fill(name)
  if (mode) await p.locator('select[name="mode"]').selectOption(mode)
  await p.getByRole('button', { name: 'Create' }).click()
}

async function connect(page: Page, source: string, listener: string) {
  const p = platform(page)
  await p.locator(`[role="treeitem"][data-id="o:host/${source}/${CHANGED}"] .line`).first().click()
  await p.locator(`[data-connect="host/${listener}/${INFO}"]`).click()
  await p.locator(`[role="treeitem"][data-id="o:host/${source}/${CHANGED}"] .line`).first().click()   // unselect
}

/** Opens a dock panel showing an existing instance (as the wires view does). */
const openPanel = (page: Page, kind: string, name: string) =>
  page.evaluate(([kind, name]) => document.dispatchEvent(new CustomEvent('wires:open-panel', { detail: { kind, name }, bubbles: true })), [kind, name])

async function pick(root: Page | FrameLocator | Locator, value: string) {
  await root.locator('nano-picker [role="combobox"]').first().click()
  await root.locator(`nano-picker [role="option"][data-value="${value}"]`).first().click()
}

const sandboxFrame = (page: Page, attr: string) => page.frameLocator(`iframe[sandbox="${attr}"]`).first()

test('a picker in each deploy mode, wired to one log', async ({ page }) => {
  await page.goto('/#/systems')
  await importTemplate(page, 'trusted')

  for (const [name, mode] of Object.entries(MODES)) await add(page, 'picker', name, mode)
  await add(page, 'log', 'L')

  // the table says how each was deployed, and Highlight marks only the sandboxed ones
  for (const [name, mode] of Object.entries(MODES))
    await expect(table(page).locator(`tr[data-deploy="${mode}"]`).filter({ hasText: name })).toHaveCount(1)
  await table(page).getByRole('button', { name: 'Highlight sandboxed' }).click()
  await expect(table(page).locator('tr[data-mark]')).toHaveCount(2)

  for (const name of Object.keys(MODES)) await connect(page, name, 'L')
  await expect(platform(page).locator('[role="treeitem"][data-id^="x:host/"]').filter({ hasText: `→ L · ${INFO}` })).toHaveCount(3)

  // open each in the dock and pick a different option in each
  await page.goto('/#/workspace')
  for (const name of Object.keys(MODES)) await openPanel(page, 'picker', name)
  await openPanel(page, 'log', 'L')
  await pick(page.locator('workspace-dock'), 'normal')                    // host: the element is in the page
  await pick(sandboxFrame(page, 'allow-scripts allow-same-origin'), 'fast')   // sandbox
  await pick(sandboxFrame(page, 'allow-scripts'), 'normal')                   // isolated-sandbox

  const log = page.locator('workspace-dock c-log[name="L"]')
  await expect(log).toContainText('3 entries')
  for (const v of ['"normal"', '"fast"']) await expect(log).toContainText(v)
})

test('an isolated sandbox reaches nothing of the host; a same-origin one does', async ({ page }) => {
  await page.goto('/#/systems')
  await importTemplate(page, 'trusted')
  await add(page, 'picker', 's1', 'sandbox')
  await add(page, 'picker', 'i1', 'isolated-sandbox')
  await page.goto('/#/workspace')
  await openPanel(page, 'picker', 's1'); await openPanel(page, 'picker', 'i1')

  const frames = async (attr: string): Promise<Frame> => {
    const handle = await page.locator(`iframe[sandbox="${attr}"]`).first().elementHandle()
    return (await handle!.contentFrame())!
  }
  const probe = () => { try { return [localStorage.length >= 0, !!parent.document.title] } catch { return 'blocked' } }
  expect(await (await frames('allow-scripts allow-same-origin')).evaluate(probe)).toEqual([true, true])
  expect(await (await frames('allow-scripts')).evaluate(probe)).toBe('blocked')
})

test('a sandboxed import never loads the module in the host page', async ({ page }) => {
  const hostLoads: string[] = []
  page.on('request', r => { if (r.url().startsWith('http://localhost:5174/') && r.url().endsWith('.js') && r.frame() === page.mainFrame()) hostLoads.push(r.url()) })
  await page.goto('/#/systems')
  await importTemplate(page, 'sandboxed')

  await platform(page).getByRole('button', { name: '+ Add' }).click()
  await platform(page).locator('select[name="kind"]').selectOption('picker')
  await expect(platform(page).locator('select[name="mode"] option')).toHaveText(['isolated-sandbox'])
  expect(hostLoads).toEqual([])
})
