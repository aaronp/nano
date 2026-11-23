// The template imported from another origin (http://localhost:5174) in one Import click: the dialog shows where its
// providers come from and is the consent. Sandboxed (the default) lands its pods isolated-sandbox in acme.template.main;
// Trusted lands them host, their views defined. Either way the imported calculator works (2 + 3 = 5, in its history), and
// under Trusted a calculator added from the picker, with no pipes, works too.
import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test'

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
  expect(got.runtimes['acme.template.main'].pods).toEqual(['calculator', 'history'])
  return got
}

/** In a calculator's view: 2 + 3, =, and the result is 5. */
async function twoPlusThree(view: Locator | FrameLocator, approve = async () => {}) {
  await view.getByLabel('a', { exact: true }).fill('2')
  await view.getByLabel('operator').selectOption('+')
  await view.getByLabel('b', { exact: true }).fill('3')
  await view.getByRole('button', { name: 'equals' }).click()
  await approve()
  await expect(view.getByLabel('result')).toHaveText('5', { timeout: 10_000 })
}

test('the template from another origin, Sandboxed: its pods isolated-sandbox in acme.template.main, nothing asks; the calculator works', async ({ page }) => {
  const got = await importTemplate(page, 'Sandboxed')
  for (const p of ['calculator', 'history']) expect(got.pods[p].isolation).toBe('isolated-sandbox')
  const dock = page.locator('workspace-dock#workspace')
  await dock.locator('nano-explorer').getByText('calculator', { exact: true }).first().dblclick()
  // its provider is never loaded into this page, so its view tag is not defined here: the panel is the sandboxed view
  await expect(dock.locator('nano-sandboxed').first()).toBeVisible()
  expect(await page.evaluate(() => !!customElements.get('nano-calculator'))).toBe(false)
  // the view runs in the pod's frame: 2 + 3 = 5 there, and the pipe saved it to the history pod (a sandboxed view
  // reaches only its own pod, so the history is read here through the host's app, not in the view's list)
  await twoPlusThree(page.frameLocator('#nano-sandbox-layer iframe:visible').locator('nano-calculator'))
  await expect.poll(() => page.evaluate(() => (document.querySelector('workspace-dock') as any).host.app.call('acme.template.main', 'history').load(null)))
    .toEqual({ ok: true, value: [{ a: 2, op: '+', b: 3, result: 5 }] })
  await expect(page.locator('dialog[open]')).toHaveCount(0)
})

test('the template from another origin, Trusted: host pods, its view once approved, and a picked calculator that works', async ({ page }) => {
  const got = await importTemplate(page, 'Trusted')
  for (const p of ['calculator', 'history']) expect(got.pods[p].isolation ?? 'host').toBe('host')
  const dock = page.locator('workspace-dock#workspace')
  const approve = async () => {   // running foreign code in this page asks first
    const yes = page.locator('dialog[open]').getByRole('button', { name: 'Approve' })
    while (await yes.isVisible().catch(() => false) || await yes.waitFor({ timeout: 1000 }).then(() => true, () => false)) await yes.click()
  }

  // (a) opening the calculator's panel starts its pod, so its foreign code asks to run in this page; approved, the panel is
  // its own view, not the generic one: 2 + 3 = 5, and the pipe saved it to the history
  await dock.locator('nano-explorer').getByText('calculator', { exact: true }).first().dblclick()
  const ask = page.locator('dialog[open]').filter({ hasText: /Run acme\.template.* in this page\?/ })
  await ask.getByRole('button', { name: 'Approve' }).click()
  const imported = dock.locator('nano-calculator').first()
  await expect(imported).toBeVisible()
  await twoPlusThree(imported, approve)
  await expect(imported.getByLabel('history').locator('li')).toHaveText(['2 + 3 = 5'])

  // (b) a calculator from the picker's imported provider group (a panel header's +), placed in main with no pipes:
  // 2 + 3 = 5 too, and with no history in its runtime its list stays empty
  await dock.getByRole('button', { name: 'Add a panel' }).first().click()
  await page.locator('nano-picker [data-kind="provider"]:not([data-section="nano.ui"])').getByRole('button', { name: 'calculator', exact: true }).click()
  await approve()
  await expect(dock.locator('nano-calculator')).toHaveCount(2)
  const picked = await page.evaluate(() => Object.keys((document.querySelector('workspace-dock') as any).host.data().pods).find(p => /^calculator.+/.test(p)))
  expect(picked).toBeTruthy()
  await page.evaluate(() => document.querySelectorAll('nano-calculator').forEach(e => e.setAttribute('data-pod', (e as any).target.pod)))
  const view = dock.locator(`nano-calculator[data-pod="${picked}"]`)
  await twoPlusThree(view, approve)
  await expect(view.getByLabel('history').locator('li')).toHaveCount(0)
})
