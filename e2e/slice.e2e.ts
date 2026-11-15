import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

test('use case 1: import, see, swap live, save', async ({ page }) => {
  await page.goto('/?src=/examples/slice/nano.json')
  const open = (pod: string) => page.locator('nano-explorer').getByText(pod, { exact: true }).first().click()
  const log = page.locator('nano-log')

  for (const pod of ['in', 'wait', 'up', 'out']) await expect(page.locator('nano-explorer').getByText(pod, { exact: true }).first()).toBeVisible()
  // the host's own pod `ui` is a footprint too: the slice's four, plus it
  for (const pod of ['in', 'wait', 'up', 'out']) await expect(page.locator(`nano-wiring .fp[data-instance="${pod}"]`)).toHaveCount(1)
  await expect(page.locator('nano-wiring path[data-cable]')).toHaveCount(3)

  await open('in')
  await page.getByRole('textbox', { name: 'in', exact: true }).fill('hi')
  await page.keyboard.press('Enter')
  await open('out')
  await expect(log).toContainText('HI', { timeout: 2000 })

  await open('up')
  await page.getByRole('combobox', { name: 'Change implementation' }).click()
  await page.getByRole('option', { name: 'example.slice/shout' }).click()
  await open('in')
  await page.getByRole('textbox', { name: 'in', exact: true }).fill('hey')
  await page.keyboard.press('Enter')
  await open('out')
  await expect(log).toContainText('hey!', { timeout: 2000 })

  await page.getByRole('combobox', { name: 'View' }).click()
  await page.getByRole('option', { name: 'nano-pod-view' }).click()
  // the pod view counts calls from when it opens, and the view area shows one pod: send another through the slice from the page
  await page.evaluate(() => (document.querySelector('workspace-shell') as any).host.app.call('main', 'in').submit('again'))
  await expect(page.locator('nano-pod-view tr[data-port="nano.ui.Log/log"]')).toContainText(/[1-9]\d* calls/, { timeout: 2000 })

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save' }).click()])
  const saved = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  expect(saved.pods.up.implementation).toBe('example.slice/shout')
  expect(saved.views.out).toBe('nano-pod-view')
})
