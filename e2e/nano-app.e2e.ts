// The whole `test-nano` loop: the nano-app CLI on a temp copy of the template (built from this commit's libraries), in the
// browser. Open, calculate, Save to the file, reload (from the file), a rebuild reloads a clean page and asks a dirty one.
import { expect, test, type Page } from '@playwright/test'
import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APPS, PUBLISHED } from '../scripts/build-packages-list'

const sh = (cmd: string, cwd = root) => execSync(cmd, { cwd, stdio: 'pipe' }).toString().trim()
const root = join(__dirname, '..'), template = join(root, 'templates/nano-template'), PORT = 5391, url = `http://127.0.0.1:${PORT}/`
let at = '', server: ChildProcess | undefined
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {   // as scripts/template-check.ts: packed libraries from this commit in a scratch copy of the template
  test.setTimeout(600_000)
  sh('bun scripts/build-packages.ts')
  at = mkdtempSync(join(tmpdir(), 'nano-app-e2e-'))
  cpSync(template, at, { recursive: true, filter: src => !/[/\\](node_modules|dist)([/\\]|$)/.test(src.slice(template.length)) })
  const original = readFileSync(join(at, 'package.json'), 'utf8'), pkg = JSON.parse(original)
  for (const [dirs, key] of [[PUBLISHED, 'dependencies'], [APPS, 'devDependencies']] as const) for (const dir of dirs) {
    const dist = join(root, 'packages', dir, 'dist'), { name } = JSON.parse(readFileSync(join(dist, 'package.json'), 'utf8'))
    pkg[key][name] = `file:./${sh(`npm pack ${dist} --pack-destination ${at} --silent`, at)}`
  }
  writeFileSync(join(at, 'package.json'), JSON.stringify(pkg, null, 2))
  rmSync(join(at, 'bun.lock'), { force: true })
  sh('bun install', at)
  writeFileSync(join(at, 'package.json'), original)
  server = spawn('bun', ['node_modules/@pritzlaff/nano-app/bin/nano-app.ts', 'nano.json'], { cwd: at, env: { ...process.env, PORT: String(PORT), NO_OPEN: '1' }, stdio: 'ignore' })
  for (let i = 0; i < 300; i++) { if (await fetch(url).then(r => r.ok, () => false)) break; await new Promise(r => setTimeout(r, 500)) }   // the build at startup comes first
})
test.afterAll(() => { server?.kill(); if (at) rmSync(at, { recursive: true, force: true }) })

const data = (page: Page) => page.evaluate(() => (document.querySelector('workspace-dock') as any).host.data())
const ready = async (page: Page) => { await page.goto(url); await expect(page.locator('workspace-dock#workspace')).toBeVisible(); await expect.poll(() => data(page).catch(() => null)).not.toBeNull() }
const edit = () => appendFileSync(join(at, 'src/calculator.ts'), `\n// edit ${Date.now()}\n`)
const save = async (page: Page) => { await page.getByRole('button', { name: 'File', exact: true }).click(); await page.getByRole('button', { name: /^Save$/ }).click() }

test('opens the calculator, saves to the file, reloads from it, and rebuilds reload a clean page or ask a dirty one', async ({ page }) => {
  await ready(page)
  expect((await data(page)).runtimes.main.pods).toEqual(expect.arrayContaining(['calculator', 'history']))

  // 2 + 3 = 5 in the calculator's view
  await page.locator('workspace-dock#workspace nano-explorer').getByText('calculator', { exact: true }).first().dblclick()
  const view = page.locator('workspace-dock#workspace nano-calculator').first()
  await view.getByLabel('a', { exact: true }).fill('2')
  await view.getByLabel('operator').selectOption('+')
  await view.getByLabel('b', { exact: true }).fill('3')
  await view.getByRole('button', { name: 'equals' }).click()
  await expect(view.getByLabel('result')).toHaveText('5', { timeout: 10_000 })

  // a change Save persists: a third pod in main
  await page.evaluate(async () => {
    const h = (document.querySelector('workspace-dock') as any).host, d = h.data()
    await h.apply({ ...d, pods: { ...d.pods, extra: d.pods.calculator }, runtimes: { ...d.runtimes, main: { ...d.runtimes.main, pods: [...d.runtimes.main.pods, 'extra'] } } })
  })
  await save(page)
  await expect.poll(() => JSON.parse(readFileSync(join(at, 'nano.json'), 'utf8')).app?.runtimes?.main?.pods ?? []).toContain('extra')
  const saved = JSON.parse(readFileSync(join(at, 'nano.json'), 'utf8'))
  expect(Object.keys(saved.app.pods)).toEqual(expect.arrayContaining(['calculator', 'history', 'extra']))
  expect({ ...saved.modules, ...saved.app.modules }['acme.template']).toBe('./index.js')

  // reload: the saved state shows, from the file
  await page.reload(); await ready(page)
  expect((await data(page)).runtimes.main.pods).toContain('extra')

  // clean + a source edit: the page reloads by itself (a marker on window goes away)
  await page.evaluate(() => { (window as any).marker = 1 })
  edit()
  await expect.poll(() => page.evaluate(() => (window as any).marker).catch(() => undefined), { timeout: 60_000 }).toBeUndefined()
  await ready(page)

  // dirty + a source edit: the notice, and Later keeps the page
  await page.evaluate(async () => {
    const h = (document.querySelector('workspace-dock') as any).host, d = h.data(); (window as any).marker = 1
    await h.apply({ ...d, pods: { ...d.pods, more: d.pods.calculator }, runtimes: { ...d.runtimes, main: { ...d.runtimes.main, pods: [...d.runtimes.main.pods, 'more'] } } })
  })
  edit()
  const note = page.getByText('Rebuilt — Reload (unsaved changes are lost)')
  await expect(note).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Later' }).click()
  await expect(note).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).marker)).toBe(1)
})
