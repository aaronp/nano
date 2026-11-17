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

/** File › Open…, the URL field, Fetch, Trusted (the examples' views run in this page), Import. */
async function open(page: Page, url: string) {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /^Open/ }).click()
  const d = page.getByRole('dialog', { name: 'Import components' })
  await d.getByLabel('nano.json URL').fill(url)
  await d.getByRole('button', { name: 'Fetch' }).click()
  await d.getByRole('radio', { name: /^Trusted/ }).check()
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
  await d.getByRole('radio', { name: /^Trusted/ }).check()
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toHaveCount(0)
  const list = dock(page).locator('todo-list').first()
  await list.getByRole('textbox', { name: 'New todo' }).fill('milk')
  await list.getByRole('button', { name: 'Add' }).click()
  await expect(list.locator('li')).toHaveText([/milk/])   // exactly one item
})

/** File › Open… /examples/nano.json (every example in one file), Fetch, Trusted, and every runtime unticked: the dialog. */
async function openAllUnticked(page: Page) {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /^Open/ }).click()
  const d = page.getByRole('dialog', { name: 'Import components' })
  await d.getByLabel('nano.json URL').fill('/examples/nano.json')
  await d.getByRole('button', { name: 'Fetch' }).click()
  await d.getByRole('radio', { name: /^Trusted/ }).check()
  for (const box of await d.locator('input[data-select-runtime]').all()) await box.uncheck()
  await expect(d.getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
  return d
}

test('all the examples in one file, only the chat ticked: only its pods land, and alice reaches bob', async ({ page }) => {
  await start(page)
  const d = await openAllUnticked(page)
  for (const r of ['example.chat.backend', 'example.chat.room']) await d.getByLabel(`Import runtime ${r}`, { exact: true }).check()
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toHaveCount(0)
  expect((await runtimes(page)).filter(r => r.includes('.'))).toEqual(['example.chat.backend', 'example.chat.room'])   // and the workspace's own main
  const pods = await page.evaluate(() => Object.keys((document.querySelector('workspace-dock') as any).host.data().pods))
  expect(pods).toEqual(expect.arrayContaining(['alice', 'bob', 'chatStore', 'messaging']))
  for (const p of ['todos', 'todoStore', 'auth', 'timer', 'store']) expect(pods).not.toContain(p)
  await say(room(page, 'alice'), 'hi bob')
  await expect(room(page, 'bob').locator('li')).toHaveText([/alice.*hi bob/])
})

test('all the examples in one file, todos ticked without todoStore: the dialog warns, and Import is still allowed', async ({ page }) => {
  await start(page)
  const d = await openAllUnticked(page)
  await d.getByLabel('Import pod todos', { exact: true }).check()
  await expect(d.locator('.warnings')).toContainText('todos calls todoStore, which is not selected: todos will fail when it runs')
  await expect(d.getByRole('button', { name: 'Import', exact: true })).toBeEnabled()
})

test('make serve-examples, imported from its own origin: every example is offered, and the chat, imported trusted and approved, works', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /^Open/ }).click()
  const d = page.getByRole('dialog', { name: 'Import components' })
  await d.getByLabel('nano.json URL').fill('http://localhost:4310/nano.json')
  await d.getByRole('button', { name: 'Fetch' }).click()
  for (const r of ['example.todo.frontend', 'example.todo.backend', 'example.chat.room', 'example.chat.backend', 'example.auth.main', 'acme.template.main'])
    await expect(d.getByLabel(`Import runtime ${r}`, { exact: true })).toBeVisible()
  await expect(d).toContainText('localhost:4310')   // the foreign-origin notice
  await d.getByRole('radio', { name: /^Trusted/ }).check()
  for (const box of await d.locator('input[data-select-runtime]').all()) await box.uncheck()
  for (const r of ['example.chat.backend', 'example.chat.room']) await d.getByLabel(`Import runtime ${r}`, { exact: true }).check()
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toHaveCount(0)
  // a trusted pod from another origin asks once before it first runs with this page's access
  const approveAll = async () => { for (let i = 0; i < 6; i++) { const a = page.locator('dialog[open]').getByRole('button', { name: 'Approve' }); if (await a.count()) await a.first().click(); else await page.waitForTimeout(300) } }
  await approveAll()
  await say(room(page, 'alice'), 'across origins'); await approveAll()
  await expect(room(page, 'bob').locator('li')).toHaveText([/alice.*across origins/])
})

test('imported Sandboxed (the default), the pods start at once and their own views render in their frames', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /^Open/ }).click()
  const d = page.getByRole('dialog', { name: 'Import components' })
  await d.getByLabel('nano.json URL').fill('http://localhost:4310/nano.json')
  await d.getByRole('button', { name: 'Fetch' }).click()
  for (const box of await d.locator('input[data-select-runtime]').all()) await box.uncheck()
  for (const r of ['example.chat.backend', 'example.chat.room']) await d.getByLabel(`Import runtime ${r}`, { exact: true }).check()
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toHaveCount(0)
  await expect(dock(page).getByText('not running')).toHaveCount(0)
  // alice's own <chat-room> renders inside her sandbox frame
  await expect.poll(async () => {
    for (const f of page.frames()) if (await f.locator('chat-room').filter({ has: f.getByRole('heading', { name: 'alice', exact: true }) }).count()) return true
    return false
  }, { timeout: 10_000 }).toBe(true)
})

test('imported Sandboxed, todos shows <todo-list> in its frame, and every frame takes the theme, live', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /^Open/ }).click()
  const d = page.getByRole('dialog', { name: 'Import components' })
  await d.getByLabel('nano.json URL').fill('http://localhost:4310/nano.json')
  await d.getByRole('button', { name: 'Fetch' }).click()
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toHaveCount(0)
  const todoFrame = async () => { for (const f of page.frames()) if (await f.locator('todo-list').count()) return f }
  await expect.poll(async () => (await todoFrame())?.getByRole('textbox', { name: 'New todo' }).count(), { timeout: 10_000 }).toBe(1)
  const f = (await todoFrame())!
  const bg = (w: { evaluate: Page['evaluate'] }) => w.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await expect.poll(async () => await bg(f)).toBe(await bg(page))
  const before = await bg(page)
  await page.goto('/#/themes')
  await page.locator('theme-picker').getByText('Terminal', { exact: true }).click()
  await expect.poll(async () => await bg(page)).not.toBe(before)
  await expect.poll(async () => await bg(f)).toBe(await bg(page))
})

/** File › Open… the served examples, Sandboxed (the default), only runtimes matching `want` ticked. */
async function openSandboxed(page: Page, want: RegExp) {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /^Open/ }).click()
  const d = page.getByRole('dialog', { name: 'Import components' })
  await d.getByLabel('nano.json URL').fill('http://localhost:4310/nano.json')
  await d.getByRole('button', { name: 'Fetch' }).click()
  await expect(d.locator('input[data-select-runtime]').first()).toBeVisible()
  for (const box of await d.locator('input[data-select-runtime]').all()) await box.uncheck()
  for (const box of await d.locator('input[data-select-runtime]').all()) if (want.test((await box.getAttribute('data-select-runtime')) ?? '')) await box.check()
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toHaveCount(0)
}
/** The first frame holding `css` (a heading `name` inside it, if given). */
async function frameWith(page: Page, css: string, name?: string) {
  for (const f of page.frames()) {
    const l = name ? f.locator(css).filter({ has: f.getByRole('heading', { name, exact: true }) }) : f.locator(css)
    if (await l.count()) return l
  }
}

test("imported Sandboxed, alice says something and bob's frame shows it live", async ({ page }) => {
  await start(page)
  await openSandboxed(page, /example\.chat\./)
  await expect.poll(async () => !!(await frameWith(page, 'chat-room', 'bob')), { timeout: 10_000 }).toBe(true)
  const bob = (await frameWith(page, 'chat-room', 'bob'))!
  const alice = (await frameWith(page, 'chat-room', 'alice'))!
  await alice.getByRole('textbox', { name: 'Message' }).fill('hi from a frame')
  await alice.getByRole('button', { name: 'Send' }).click()
  await expect(bob.locator('li')).toHaveText([/alice.*hi from a frame/])
})

test('imported Sandboxed, todos: an add puts the item in the list in its frame', async ({ page }) => {
  await start(page)
  await openSandboxed(page, /example\.todo\./)
  await expect.poll(async () => !!(await frameWith(page, 'todo-list')), { timeout: 10_000 }).toBe(true)
  const list = (await frameWith(page, 'todo-list'))!
  await list.getByRole('textbox', { name: 'New todo' }).fill('milk')
  await list.getByRole('button', { name: 'Add' }).click()
  await expect(list.locator('li')).toHaveText([/milk/])
  await list.getByRole('textbox', { name: 'New todo' }).fill('eggs')
  await list.getByRole('textbox', { name: 'New todo' }).press('Enter')
  await expect(list.locator('li')).toHaveText([/milk/, /eggs/])
})
