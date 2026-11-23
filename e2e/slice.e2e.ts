import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

test('use case 1: import, see, swap live, save', async ({ page }) => {
  await page.goto('/?src=/examples/slice/nano.json')
  const open = (pod: string) => page.locator('nano-explorer').getByText(pod, { exact: true }).first().dblclick()
  const log = page.locator('nano-log')

  for (const pod of ['in', 'wait', 'up', 'out']) await expect(page.locator('nano-explorer').getByText(pod, { exact: true }).first()).toBeVisible()
  // Connections: the slice's four (in panels or the rack), never the host's own pod `ui`, and its three cables
  await page.getByRole('button', { name: 'Connections' }).first().click()
  const wires = page.locator('c-wires')
  await expect(wires).toHaveAttribute('flipped', '')
  const shown = () => page.evaluate(() => { const m = (document.querySelector('c-wires') as any).model; return [...m.chassis.flatMap((c: any) => c.instance ?? []), ...m.rack.map((r: any) => r.id)].sort() })
  await expect.poll(shown).toEqual(expect.arrayContaining(['in', 'out', 'up', 'wait']))
  expect(await shown()).not.toContain('ui')
  await expect(wires.locator('[data-wire]')).toHaveCount(3)
  await wires.getByRole('button', { name: 'Back to the workspace' }).click()
  await expect(wires).not.toHaveAttribute('flipped', '')

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
  await page.evaluate(() => (document.querySelector('workspace-dock') as any).host.app.call('main', 'in').submit('again'))
  await expect(page.locator('nano-pod-view tr[data-port="nano.ui.Log/log"]')).toContainText(/[1-9]\d* calls/, { timeout: 2000 })

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'File', exact: true }).click().then(() => page.getByRole('button', { name: 'Save', exact: true }).click())])
  const saved = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  // the bundle: the app, its outline, and the host's own (the views chosen)
  expect(saved.app.pods.up.implementation).toBe('example.slice/shout')
  expect(saved.host.views.out).toBe('nano-pod-view')
})

test('the template: import its nano.json, open the timer, see it tick', async ({ page }) => {
  await page.goto('/?src=/examples/template/nano.json')
  await page.locator('nano-explorer').getByText('timer', { exact: true }).first().dblclick()
  const timer = page.locator('nano-timer')
  await expect(timer).toBeVisible()
  await timer.getByRole('button', { name: 'Start' }).click()
  await expect(timer.locator('.badge')).not.toHaveText('0', { timeout: 4000 })
})
