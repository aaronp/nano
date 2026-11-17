import { expect, test, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dock = (page: Page) => page.locator('workspace-dock#workspace')
/** The participant's window, by its heading (its text would also match a line mentioning the name). */
const room = (page: Page, who: string) => dock(page).locator('chat-room').filter({ has: page.getByRole('heading', { name: who, exact: true }) })
const runtimes = (page: Page) => page.evaluate(() => Object.keys((document.querySelector('workspace-dock') as any).host.data().runtimes).sort())

async function start(page: Page) {
  await page.goto('/#/workspace')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(dock(page).locator('nano-explorer')).toBeVisible()
}

/** File › Open…, the URL field, Fetch, Import. */
async function open(page: Page, url: string) {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /^Open/ }).click()
  const d = page.getByRole('dialog', { name: 'Import components' })
  await d.getByLabel('nano.json URL').fill(url)
  await d.getByRole('button', { name: 'Fetch' }).click()
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toHaveCount(0)
}

async function say(room: ReturnType<Page['locator']>, text: string) {
  await room.getByRole('textbox', { name: 'Message' }).fill(text)
  await room.getByRole('button', { name: 'Send' }).click()
}

test('todo: add milk in <todo-list>, tick it', async ({ page }) => {
  await start(page)
  await open(page, '/examples/todo/nano.json')
  const list = dock(page).locator('todo-list').first()
  await list.getByRole('textbox', { name: 'New todo' }).fill('milk')
  await list.getByRole('button', { name: 'Add' }).click()
  await expect(list.locator('li')).toHaveText([/milk/])   // exactly one item
  const box = list.getByRole('checkbox', { name: 'Done: milk' })
  await box.click()
  await expect(box).toBeChecked()
})

test("chat: alice says hi, bob's window shows it", async ({ page }) => {
  await start(page)
  await open(page, '/examples/chat/nano.json')
  const alice = room(page, 'alice'), bob = room(page, 'bob')
  await expect(alice).toHaveCount(1); await expect(bob).toHaveCount(1)
  await say(alice, 'hi bob')
  await expect(bob.locator('li')).toHaveText([/alice.*hi bob/])   // exactly one line, from alice
  await expect(alice.locator('li')).toHaveText([/alice.*hi bob/])
})

test('todo and chat import side by side: no runtime clash', async ({ page }) => {
  await start(page)
  await open(page, '/examples/todo/nano.json')
  await open(page, '/examples/chat/nano.json')
  const names = await runtimes(page)
  expect(names).toEqual(expect.arrayContaining(['example.chat.backend', 'example.chat.room', 'example.todo.backend', 'example.todo.frontend']))
  // the second file's slots replace the panels (the workspace's own rule); todos is still there, from the explorer
  await expect(dock(page).locator('chat-room')).toHaveCount(2)
  const node = dock(page).locator('nano-explorer').getByText('todos', { exact: true })   // the dock's Systems panel
  await expect(node).toHaveCount(1)
  await node.click()
  const list = dock(page).locator('todo-list')
  await list.getByRole('textbox', { name: 'New todo' }).fill('eggs')
  await list.getByRole('button', { name: 'Add' }).click()
  await expect(list.locator('li')).toHaveText([/eggs/])
  await say(room(page, 'alice'), 'still here')
  await expect(room(page, 'bob').locator('li')).toHaveText([/alice.*still here/])
})

test('auth: with a virtual authenticator, Register then Passkey; the log shows ok', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } })
  await start(page)
  await open(page, '/examples/auth/nano.json')
  const auth = dock(page).locator('auth-passkey')
  await auth.getByRole('button', { name: 'Register' }).click()
  await expect(auth.getByRole('status')).toContainText('register: ok')
  await auth.getByRole('button', { name: 'Passkey' }).click()
  await page.locator('dialog[open]').getByRole('button', { name: 'Approve' }).click()
  await expect(auth.getByRole('status')).toContainText('sign in: ok')
  const log = dock(page).locator('nano-log')
  await expect(log).toContainText('"ok":true')
  await expect(log).toContainText('"credentialId"')
  await expect(log).not.toContainText(/prf|secret|signature|clientDataJSON/i)   // nothing sensitive reaches the log
})


test('a built example opens from a local file when its modules are absolute', async ({ page, baseURL }) => {
  const out = mkdtempSync(join(tmpdir(), 'nano-examples-'))
  const built = spawnSync('bun', ['scripts/build.ts', out], { stdio: 'inherit', cwd: join(__dirname, '../examples'), env: { ...process.env, PUBLIC_URL: `${baseURL}/` } })
  expect(built.status).toBe(0)
  await start(page)
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /^Open/ }).click()
  const d = page.getByRole('dialog', { name: 'Import components' })
  await d.getByLabel('nano.json file').setInputFiles(join(out, 'todo/nano.json'))
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toHaveCount(0)
  const list = dock(page).locator('todo-list').first()
  await list.getByRole('textbox', { name: 'New todo' }).fill('milk')
  await list.getByRole('button', { name: 'Add' }).click()
  await expect(list.locator('li')).toHaveText([/milk/])   // exactly one item
})
