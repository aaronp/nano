import { expect, test, type Page } from '@playwright/test'

// Needs the docs built into packages/ui-workspace/public/docs first (`make docs-build`): the Playwright web server doesn't build them.

// Expected lines copied exactly from examples/tutorial/01-plain.test.ts and 05-runtime.test.ts (those are bun:test files).
const LINES: Record<string, string[]> = {
  '01-plain': ['2 + 3 = 5', '1 / 0: cannot divide by zero'],
  '05-runtime': ['2 + 3 = 5', '{"ok":true,"value":{"a":2,"op":"+","b":3,"result":5}}'],
}
const open = async (page: Page, step: string) => {
  await page.goto(`/docs/learn/${step}.html`) // the static server has no clean URLs
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  const editor = page.getByLabel(`${step} code`)
  await expect(editor).toBeVisible()
  return { editor, out: page.getByRole('log'), run: page.getByRole('button', { name: 'Run' }), reset: page.getByRole('button', { name: 'Reset' }) }
}
const replaceCode = async (page: Page, editor: ReturnType<Page['getByLabel']>, code: string) => {
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(code)
}

for (const step of Object.keys(LINES)) test(`${step} runs and prints what its test asserts`, async ({ page }) => {
  const { run, out } = await open(page, step)
  await run.click()
  await expect(out.locator('div')).toHaveText(LINES[step]!)
})

test('an edit changes the output; Reset restores the original', async ({ page }) => {
  const { editor, run, reset, out } = await open(page, '01-plain')
  await replaceCode(page, editor, "export async function main(log) {\n  log('2 + 3 = ' + (2 + 40))\n}")
  await run.click()
  await expect(out.locator('div')).toHaveText(['2 + 3 = 42'])
  await reset.click()
  await run.click()
  await expect(out.locator('div')).toHaveText(LINES['01-plain']!)
})

const failing: [string, string, RegExp][] = [
  ['a throw', "export async function main() { throw new Error('boom') }", /^boom$/],
  ['a frame that cannot read the page', 'export async function main(log) { log(String(!!window.parent.document)) }', /Blocked a frame with origin "null" from accessing a cross-origin frame/],
]
for (const [name, code, text] of failing) test(`${name} shows an error line`, async ({ page }) => {
  const { editor, run, out } = await open(page, '01-plain')
  await replaceCode(page, editor, code)
  await run.click()
  await expect(out.locator('div')).toHaveCount(1)
  await expect(out.locator('div.err')).toHaveText(text)
  await expect(out).not.toContainText('true')
})

test('a run that never ends is stopped after 5 seconds', async ({ page }) => {
  test.setTimeout(30_000)
  const { editor, run, out } = await open(page, '01-plain')
  await replaceCode(page, editor, 'export async function main() { for (;;) {} }')
  await run.click()
  await expect(out.locator('div')).toHaveText(['Stopped: still running after 5 seconds.'], { timeout: 12_000 })
})

test('Ctrl+Enter runs', async ({ page }) => {
  const { editor, out } = await open(page, '01-plain')
  await editor.click()
  await page.keyboard.press('Control+Enter')
  await expect(out.locator('div')).toHaveText(LINES['01-plain']!)
})

test('the editor follows the dark-mode switch', async ({ page }) => {
  const { editor } = await open(page, '01-plain')
  const bg = () => editor.locator('xpath=ancestor::*[contains(@class,"cm-editor")]').evaluate(e => getComputedStyle(e).backgroundColor)
  const before = await bg()
  await page.locator('.VPSwitchAppearance:visible').click()
  await expect.poll(bg).not.toBe(before)
})
