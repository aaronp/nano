import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// SHOTS=<dir> also screenshots each step there.
const shot = (page: Page, name: string) => process.env['SHOTS'] ? page.screenshot({ path: `${process.env['SHOTS']}/${name}.png` }) : Promise.resolve()
const dock = (page: Page) => page.locator('workspace-dock#workspace')
const pods = (page: Page) => page.evaluate(() => Object.keys((document.querySelector('workspace-dock') as any).host.data().pods).filter(p => !['ui', 'deploy', 'pages'].includes(p)).sort())   // the host's own pods (HOST_PODS)
const pipes = (page: Page) => page.evaluate(() => (document.querySelector('workspace-dock') as any).host.data().runtimes.main.subscriptions.map((s: any) => `${s.from}>${s.to}`).sort())

/** Drags a cord in <c-wires>'s edit mode from one jack to another, with the mouse, where the jacks are drawn. */
async function patch(page: Page, from: string, to: string) {
  const at = (key: string) => page.evaluate(k => {
    const w = document.querySelector('c-wires') as any, r = w.renderRoot.querySelector('.plate-bg').getBoundingClientRect(), p = w.model.P[k]
    if (!p) throw new Error(`no jack ${k}: ${Object.keys(w.model.P).join(', ')}`)
    return { x: r.left + p.x / w.model.W * r.width, y: r.top + p.y / w.model.H * r.height }
  }, key)
  const a = await at(from), b = await at(to)
  await page.mouse.move(a.x, a.y); await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 4 })
  await page.mouse.up()
}

test('drop four controls, wire them in Connections, save, New, import the file: the same app, working', async ({ page }) => {
  await page.goto('/#/workspace')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(dock(page).locator('nano-explorer')).toBeVisible()

  // 1. the picker's built-ins (a panel header's +), each a pod in a panel of its own
  for (const c of ['input', 'debounce', 'map', 'log']) {
    await dock(page).getByRole('button', { name: 'Add a panel' }).first().click()
    await page.locator('nano-picker').getByRole('button', { name: c, exact: true }).first().click()
  }
  await expect.poll(() => pods(page)).toEqual(['debounce1', 'input1', 'log1', 'map1'])
  await expect(dock(page).locator('nano-log')).toHaveCount(1)
  await shot(page, '1-controls')

  // 2. Connections tilts the dock to its back; Edit wiring; cords from out jacks to in jacks
  await page.getByRole('button', { name: 'Connections' }).first().click()
  await expect(page.locator('c-wires')).toHaveAttribute('flipped', '')
  await page.locator('c-wires').getByRole('button', { name: 'Edit wiring' }).click()
  await page.waitForTimeout(800)   // the pane turns to face its back
  await shot(page, '2a-connections')
  await patch(page, 'input1 nano.ui.Input/submit:out', 'debounce1 nano.ui.Debounce/push:in')
  await patch(page, 'debounce1 nano.ui.Debounce/flushed:out', 'map1 nano.ui.Map/map:in')
  await patch(page, 'map1 nano.ui.Map/map:out', 'log1 nano.ui.Log/log:in')
  await expect.poll(() => pipes(page)).toEqual(['debounce1>map1', 'input1>debounce1', 'map1>log1'])
  await shot(page, '2b-wired')
  await page.locator('c-wires').getByRole('button', { name: 'Done editing' }).click()
  await page.locator('c-wires').getByRole('button', { name: 'Back to the workspace' }).click()
  await expect(page.locator('c-wires')).not.toHaveAttribute('flipped', '')

  // it works before saving too
  const type = async (text: string) => { const box = dock(page).getByRole('textbox', { name: 'input1', exact: true }); await box.fill(text); await box.press('Enter') }
  await type('one')
  await expect(dock(page).locator('nano-log')).toContainText('one', { timeout: 3000 })

  // 3. File › Save As… demo
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /Save As/ }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('demo')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: /Save|OK/ }).click()])
  expect(download.suggestedFilename()).toBe('demo.json')
  const file = (await download.path())!, saved = JSON.parse(readFileSync(file, 'utf8'))
  expect(Object.keys(saved.pods).sort()).toEqual(['debounce1', 'input1', 'log1', 'map1'])
  expect(saved.runtimes.main.subscriptions).toHaveLength(3)
  expect(JSON.stringify(saved.layout.workspace)).toContain('log1')
  // beside the dock's own state, the neutral layout: a slot and a box per pod
  expect(saved.layout.slots.map((s: { pod: string }) => s.pod).sort()).toEqual(['debounce1', 'input1', 'log1', 'map1'])
  for (const s of saved.layout.slots) expect(saved.layout.geometry[s.id]).toMatchObject({ w: expect.any(Number), h: expect.any(Number) })
  await shot(page, '3-saved')

  // 4. File › New: nothing but the starting dock
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect.poll(() => pods(page)).toEqual([])
  await expect(dock(page).locator('nano-log')).toHaveCount(0)
  await shot(page, '4-new')

  // 5. File › Open…, choose demo.json, Import: the pods, pipes and panels back, and working
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /^Open/ }).click()
  await page.getByLabel('nano.json file').setInputFiles(file)
  await expect(page.locator('dialog .preview')).toContainText('input1')
  await page.locator('dialog').getByRole('button', { name: 'Import', exact: true }).click()
  await expect.poll(() => pods(page)).toEqual(['debounce1', 'input1', 'log1', 'map1'])
  await expect.poll(() => pipes(page)).toEqual(['debounce1>map1', 'input1>debounce1', 'map1>log1'])
  await expect(dock(page).locator('nano-log')).toHaveCount(1)
  await type('two')
  await expect(dock(page).locator('nano-log')).toContainText('two', { timeout: 3000 })
  await shot(page, '5-imported')

  await page.goto('/#/wiring')
  await expect(page.locator('c-circuit').locator('path[data-cable]')).toHaveCount(3)
  await page.waitForTimeout(800)
  await shot(page, '6-wiring-page')
})

test('opens a file with slots but no workspace state: a panel per slot', async ({ page }) => {
  await page.goto('/#/workspace')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  const file = { pods: { in1: { implementation: 'nano.ui/input', eager: false }, out1: { implementation: 'nano.ui/log', eager: false } },
    runtimes: { main: { pods: ['in1', 'out1'], subscriptions: [{ kind: 'pipe', from: 'in1', source: 'nano.ui.Input/submit', to: 'out1', target: 'nano.ui.Log/log' }] } },
    layout: { slots: [{ id: 'a', runtime: 'main', pod: 'in1' }, { id: 'b', runtime: 'main', pod: 'out1' }] } }
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /^Open/ }).click()
  await page.getByLabel('nano.json file').setInputFiles({ name: 'slots.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
  await page.locator('dialog').getByRole('button', { name: 'Import', exact: true }).click()
  await expect(dock(page).locator('nano-log')).toHaveCount(1)
  await expect(dock(page).getByRole('textbox', { name: 'in1', exact: true })).toBeVisible()
})
