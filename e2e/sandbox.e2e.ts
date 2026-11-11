// One imported package in three deploy modes, all wired to one log: host, sandbox (same-origin iframe) and
// isolated-sandbox (opaque-origin iframe) must behave the same to their neighbours, and differ only in what they reach.
import { expect, test, type Frame, type FrameLocator, type Locator, type Page } from '@playwright/test'

const MANIFEST = 'http://localhost:5210/manifest.json'   // playwright.config.ts serves the template here
const MODES = { 'p-host': 'host', 'p-sbx': 'sandbox', 'p-iso': 'isolated-sandbox' } as const
const CHANGED = 'nano.template/picker/changed', INFO = 'composable.bundle/log/info'

const platform = (page: Page) => page.locator('section.panel c-platform')
const table = (page: Page) => page.locator('section.panel c-platform-table')

async function importTemplate(page: Page, trust: 'trusted' | 'sandboxed') {
  await page.goto('/#/workspace')   // the components drawer, with Import, is on the workspace page
  await page.locator('[data-import-open]').first().click()
  const dialog = page.getByRole('dialog', { name: 'Import components' })
  await dialog.getByLabel('Manifest URL').fill(MANIFEST)
  await dialog.locator('[data-fetch]').click()
  await dialog.locator(`input[name="trust"][value="${trust}"]`).check()
  await dialog.locator('[data-import]').click()
  await expect(dialog).toBeHidden()
  await page.goto('/#/systems')
}

async function add(page: Page, kind: string, name: string, mode?: string) {
  const p = platform(page)
  await p.getByRole('button', { name: '+ Add' }).click()
  await p.locator('select[name="kind"]').selectOption(kind)
  await p.locator('input[name="name"]').fill(name)
  if (mode) await p.locator('select[name="mode"]').selectOption(mode)
  await p.getByRole('button', { name: 'Create' }).click()
}

/** Opens a tree row (a component starts closed), leaving an open one open. */
async function expand(p: Locator, id: string) {
  const row = p.locator(`li[role="treeitem"][data-id="${id}"]`).first()
  if (await row.getAttribute('aria-expanded') === 'false') await p.locator(`.chev[data-toggle="${id}"]`).first().click()
  await expect(row).toHaveAttribute('aria-expanded', 'true')
}

async function connect(page: Page, source: string, listener: string) {
  const p = platform(page)
  await expand(p, `c:host/${source}`); await expand(p, `c:host/${listener}`)
  await p.locator(`[role="treeitem"][data-id="o:host/${source}/${CHANGED}"] .line`).first().click()
  await p.locator(`[data-connect="host/${listener}/${INFO}"]`).click()
  await p.locator(`[role="treeitem"][data-id="o:host/${source}/${CHANGED}"] .line`).first().click()   // unselect
}

/** Opens a dock panel showing an existing instance (as the wires view does). */
const openPanel = (page: Page, kind: string, name: string) =>
  page.evaluate(([kind, name]) => document.dispatchEvent(new CustomEvent('wires:open-panel', { detail: { kind, name }, bubbles: true })), [kind, name])

/** Brings a dock panel's tab to the front (new panels open as tabs of one stack; a hidden one can't be used). */
const showTab = (page: Page, title: string) => page.locator('workspace-dock .lm_tab').getByText(title, { exact: true }).first().click()

async function pick(root: Page | FrameLocator | Locator, value: string) {
  // by keyboard: a sandboxed picker's list can extend past its iframe's box, where a click lands on the host page
  await root.locator('nano-picker [role="combobox"]').first().click()
  const search = root.locator('nano-picker input[role="combobox"]').first()
  await search.fill(value)
  await search.press('Enter')
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
  await showTab(page, 'p-host'); await pick(page.locator('workspace-dock'), 'normal')               // host: the element is in the page
  await showTab(page, 'p-sbx'); await pick(sandboxFrame(page, 'allow-scripts allow-same-origin'), 'fast')   // sandbox
  // isolated-sandbox: its iframe fills the panel, so its list opens inside the frame and takes a click, as a user would
  await showTab(page, 'p-iso')
  const iso = page.locator('iframe[sandbox="allow-scripts"]').first(), panel = page.locator('workspace-dock .lm_content:visible').first()
  await expect.poll(async () => (await iso.boundingBox())!.height).toBeGreaterThan((await panel.boundingBox())!.height - 40)
  await sandboxFrame(page, 'allow-scripts').locator('nano-picker [role="combobox"]').first().click()
  await sandboxFrame(page, 'allow-scripts').locator('nano-picker [role="option"][data-value="normal"]').first().click()

  await showTab(page, 'L')
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
  page.on('request', r => { if (r.url().startsWith('http://localhost:5210/') && r.url().endsWith('.js') && r.frame() === page.mainFrame()) hostLoads.push(r.url()) })
  await page.goto('/#/systems')
  await importTemplate(page, 'sandboxed')

  await platform(page).getByRole('button', { name: '+ Add' }).click()
  await platform(page).locator('select[name="kind"]').selectOption('picker')
  await expect(platform(page).locator('select[name="mode"] option')).toHaveText(['isolated-sandbox'])
  expect(hostLoads).toEqual([])
})

test("a Store keeps values in its origin's storage: localStorage in the host, memory in an isolated sandbox", async ({ page }) => {
  await page.goto('/#/systems')
  await importTemplate(page, 'trusted')
  await add(page, 'store', 'st-host', 'host')
  await add(page, 'store', 'st-iso', 'isolated-sandbox')
  await page.goto('/#/workspace')
  await openPanel(page, 'store', 'st-host'); await openPanel(page, 'store', 'st-iso')

  await showTab(page, 'st-host')
  await expect(page.locator('workspace-dock nano-store .backing').first()).toHaveText('localStorage')
  await showTab(page, 'st-iso')
  const iso = sandboxFrame(page, 'allow-scripts')
  await expect(iso.locator('nano-store .backing')).toHaveText('memory')
  await iso.locator('nano-store input[name="key"]').fill('theme')
  await iso.locator('nano-store input[name="value"]').fill('dark')
  await iso.locator('nano-store button[type="submit"]').click()
  await expect(iso.locator('nano-store tbody')).toContainText('dark')
  // nothing it stored reached the host's storage
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('nano.template/store:')))).toEqual([])
})
