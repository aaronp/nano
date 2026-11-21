import { expect, test, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { port } from '../packages/nano/src/index.ts'
import { MessagingDef } from '../examples/chat/messaging/contract.ts'
import { KeyValueStoreDef } from '../examples/kv/contract.ts'

const dock = (page: Page) => page.locator('workspace-dock#workspace')
/** The participant's window, by its heading (its text would also match a line mentioning the name). */
const room = (page: Page, who: string, at = dock(page)) => at.locator('chat-room').filter({ has: page.getByRole('heading', { name: who, exact: true }) })
const runtimes = (page: Page) => page.evaluate(() => Object.keys((document.querySelector('workspace-dock') as any).host.data().runtimes).sort())

async function start(page: Page) {
  await page.goto('/#/p/workspace')
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

/** Unticks every runtime, once Fetch has listed them. */
async function uncheckAll(d: ReturnType<Page['locator']>) {
  await expect(d.locator('input[data-select-runtime]').first()).toBeVisible()
  for (const box of await d.locator('input[data-select-runtime]').all()) await box.uncheck()
}
/** How far the page scrolls sideways: 0 when nothing is wider than the window. */
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

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
  // Main shows a pod now (todo's), so the second file's Main is a page beside it, workspace-2 (the workspace's own rule)
  const chat = page.locator('workspace-dock#ws_workspace-2')
  await page.goto('/#/p/workspace-2')
  await expect(chat.locator('chat-room')).toHaveCount(2)
  // todos is still on Main, from the explorer
  await page.goto('/#/p/workspace')
  const node = dock(page).locator('nano-explorer').getByText('todos', { exact: true })   // the dock's Systems panel
  await expect(node).toHaveCount(1)
  await node.click()   // selects: its details, with Open view
  await page.screenshot({ path: test.info().outputPath('details.png') })
  await dock(page).locator('nano-explorer').getByRole('button', { name: 'Open view' }).click()
  const list = dock(page).locator('todo-list')
  await list.getByRole('textbox', { name: 'New todo' }).fill('eggs')
  await list.getByRole('button', { name: 'Add' }).click()
  await expect(list.locator('li')).toHaveText([/eggs/])
  await page.goto('/#/p/workspace-2')
  await say(room(page, 'alice', chat), 'still here')
  await expect(room(page, 'bob', chat).locator('li')).toHaveText([/alice.*still here/])
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
  await uncheckAll(d)
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
  await expect(d.locator('[data-pod="todos"] .warning')).toContainText('todos calls todoStore, which is not selected: todos will fail when it runs')
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
  await uncheckAll(d)
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
  await uncheckAll(d)
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
  await uncheckAll(d)
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
  await expect(list.locator('li')).toHaveText([/milk/, /eggs/])   // in the order they were added
})

test('imported Sandboxed, Connections tilts the frames with the dock (they follow its 3D projection)', async ({ page }) => {
  await start(page)
  await openSandboxed(page, /todo/)
  const frame = page.locator('#nano-sandbox-layer iframe').filter({ visible: true }).first()
  await expect(frame).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Connections' }).first().click()
  await page.locator('c-wires').getByRole('button', { name: 'Angled' }).click()
  await page.waitForTimeout(1200)   // the pane turns
  await page.screenshot({ path: test.info().outputPath('connections.png') })
  const t = await frame.evaluate(f => (f as HTMLElement).style.transform)
  expect(t === '' ? 'hidden' : t).toMatch(/matrix3d|hidden/)
  expect(t).not.toMatch(/^matrix3d\([^,]+,0,0,0,0,[^,]+,0,0,/)   // not flat: it has the tilt's perspective terms
})

test("focusing a pod's panel adds its View and Implementation to the app bar, beside the workspace's own controls", async ({ page }) => {
  await start(page)
  await open(page, '/examples/todo/nano.json')
  await dock(page).locator('todo-list').first().click()
  const bar = page.locator('nano-app-bar')
  await expect(bar.getByText('Implementation', { exact: true })).toBeVisible()
  await expect(bar.getByText('View', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connections' }).first()).toBeVisible()
})

test('a participant added from the picker auto-connects to messaging, and talks in the room', async ({ page }) => {
  await start(page)
  await open(page, '/examples/chat/nano.json')
  await dock(page).getByRole('button', { name: 'Add a panel' }).first().click()
  await page.locator('nano-picker').getByRole('button', { name: 'participant', exact: true }).first().click()
  await expect(page.getByText('connected participant1 → messaging (example.messaging.Messaging)')).toBeVisible()
  await say(room(page, 'participant1'), 'hello')
  await expect(room(page, 'alice').getByText('hello')).toBeVisible()
})

test('Import groups runtimes by namespace: one box ticks a namespace, and a warning sits under its pod', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /^Open/ }).click()
  const d = page.getByRole('dialog', { name: 'Import components' })
  await d.getByLabel('nano.json URL').fill('http://localhost:4310/nano.json')
  await d.getByRole('button', { name: 'Fetch' }).click()
  await d.getByLabel('Import all of example.chat').uncheck()
  for (const p of ['alice', 'bob', 'messaging', 'chatStore']) await expect(d.getByLabel(`Import pod ${p}`, { exact: true })).not.toBeChecked()
  await expect(d.getByLabel('Import pod todos', { exact: true })).toBeChecked()
  await d.getByLabel('Import pod alice', { exact: true }).check()
  await expect(d.getByLabel('Import all of example.chat')).toHaveJSProperty('indeterminate', true)
  await expect(d.locator('[data-pod="alice"] .warning')).toContainText('alice calls messaging, which is not selected')
})

test('Connections draws the chat example\'s call edges: alice and bob to messaging, messaging to chatStore', async ({ page }) => {
  await start(page)
  await open(page, '/examples/chat/nano.json')
  await page.getByRole('button', { name: 'Connections' }).first().click()
  await expect(page.locator('c-wires')).toHaveAttribute('flipped', '')
  for (const c of ['alice|messaging', 'bob|messaging', 'messaging|chatStore'])
    await expect(page.locator(`c-wires [data-call="example.chat.backend|${c}"]`)).toHaveCount(1)
  await page.locator('c-wires').getByRole('button', { name: 'Back', exact: true }).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: test.info().outputPath('calls.png') })
  await page.locator('c-wires').getByLabel('Call edges').uncheck()
  await expect(page.locator('c-wires [data-call]')).toHaveCount(0)
  await page.locator('c-wires').getByLabel('Call edges').check()
  await expect(page.locator('c-wires [data-call]')).toHaveCount(3)
})

test('origin-key runs home-origin: its frame is its own page, and Register / Passkey make a passkey for that origin', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
  await start(page)
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /^Open/ }).click()
  const d = page.getByRole('dialog', { name: 'Import components' })
  await d.getByLabel('nano.json URL').fill('http://localhost:4310/originkey/nano.json')
  await d.getByRole('button', { name: 'Fetch' }).click()
  await expect(d.locator('[data-pod="originKey"] [data-isolation]')).toHaveText('home-origin')
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toHaveCount(0)
  const frame = page.frameLocator('#nano-sandbox-layer iframe[src="http://localhost:4310/originkey/frame.html"]')
  const key = frame.locator('origin-key')
  await expect(key.getByRole('button', { name: 'Register' })).toBeVisible({ timeout: 10_000 })
  await key.getByRole('button', { name: 'Register' }).click()
  await expect(key.getByRole('status')).toContainText('register: ok', { timeout: 10_000 })
  await key.getByRole('button', { name: 'Passkey' }).click()
  await frame.getByRole('button', { name: 'Approve' }).click()
  await expect(key.getByRole('status')).toContainText('sign in: ok', { timeout: 10_000 })
})

test('Settings shows each runtime\'s policy rules in order, the frame permissions, and where providers come from', async ({ page }) => {
  await start(page)
  await open(page, '/examples/chat/nano.json')
  await page.goto('/#/settings')
  const s = page.locator('nano-settings')
  await expect(s.getByRole('heading', { name: 'example.chat.backend' })).toBeVisible()
  const rows = s.locator('h3:text("example.chat.backend") + p + table tbody tr')
  await expect(rows).toHaveCount(6)
  await expect(rows.first()).toContainText('allow')
  await expect(rows.first()).toContainText('bob')
  await expect(rows.nth(4)).toContainText(/allow\s*start\s*host/)   // the host may start a pod there, to show its panel
  await expect(rows.last()).toContainText('deny')
  await expect(s.getByRole('row', { name: /home-origin/ })).toContainText('publickey-credentials-get')
  await expect(s.getByRole('row', { name: /example\.chat / })).toContainText('this origin')
  await page.screenshot({ path: test.info().outputPath('settings.png'), fullPage: true })
})

test('the chat, a message sent: its declared, observed messaging.post → chatStore.put is drawn op to op in Connections and listed under messaging in Systems', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await start(page)
  await open(page, '/examples/chat/nano.json')
  await say(room(page, 'alice'), 'hi bob')
  await expect(room(page, 'bob').locator('li')).toHaveText([/hi bob/])
  expect(await sideways(page)).toBe(0)   // alice's controls in the app bar don't widen the page
  await page.getByRole('button', { name: 'Connections' }).first().click()
  await expect(page.locator('c-wires')).toHaveAttribute('flipped', '')
  const edge = page.locator('c-wires [data-call="example.chat.backend|messaging|chatStore"] [data-op-call]')
  await expect(edge.first()).toBeVisible()
  // the cord's ends are messaging's post jack and one of chatStore's jacks
  const ends = await page.evaluate(() => {
    const m = (document.querySelector('c-wires') as any).model, c = m.calls.find((x: any) => x.id === 'example.chat.backend|messaging|chatStore')
    const at = (o: { x: number; y: number }) => Object.values(m.P).find((p: any) => p.x === o.x && p.y === o.y) as any
    return c.ops.map((o: any) => [at(o.a)?.owner, at(o.a)?.label, at(o.b)?.owner, o.declared, o.seen])
  })
  expect(ends).toContainEqual(['messaging', 'post', 'chatStore', true, true])   // declared and seen: the message just sent
  await page.locator('c-wires').getByRole('button', { name: 'Back', exact: true }).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: test.info().outputPath('op-calls.png') })
  await page.locator('c-wires').getByRole('button', { name: 'Back to the workspace' }).click()
  await expect(page.locator('c-wires')).not.toHaveAttribute('flipped', '')
  expect(await sideways(page)).toBe(0)
  await dock(page).locator('nano-explorer li[data-id="p:example.chat.backend:messaging"] > .line').click()
  await expect(dock(page).locator('nano-explorer .details')).toContainText('post → chatStore.put')
})

test('Connections, the chat after a message: messaging post\'s output jack is corded, dashed, to chatStore put\'s input jack; Show Connected hides a jack no cord touches', async ({ page }) => {
  const { api: M } = MessagingDef, { api: KV } = KeyValueStoreDef
  const post = `messaging ${port(M, M.ops.post)}:out`, put = `chatStore ${port(KV, KV.ops.put)}:in`, idle = `chatStore ${port(KV, KV.ops.list)}:out`
  await start(page)
  await open(page, '/examples/chat/nano.json')
  await say(room(page, 'alice'), 'hi bob')
  await expect(room(page, 'bob').locator('li')).toHaveText([/hi bob/])
  await page.getByRole('button', { name: 'Connections' }).first().click()
  const w = page.locator('c-wires')
  await expect(w).toHaveAttribute('flipped', '')
  for (const k of [post, put]) await expect(w.locator(`[data-jack="${k}"]`)).toHaveCount(1)
  // the cord runs from post's output jack to put's input jack: seen, declared, dashed
  const at = async (k: string) => { const c = w.locator(`[data-jack="${k}"] circle`).first(); return `${await c.getAttribute('cx')} ${await c.getAttribute('cy')}` }
  const [a, b] = [await at(post), await at(put)]
  const cord = w.locator(`[data-call="example.chat.backend|messaging|chatStore"] [data-op-call="seen"][d^="M${a} C"][d$=" ${b}"]`)
  await expect(cord).toHaveAttribute('stroke-dasharray', '10 6')
  // the output end is a filled socket, the input end a hollow one
  await expect(w.locator(`[data-jack="${post}"] [data-dir="out"]`)).toHaveAttribute('fill', '#E6EDF3')
  await expect(w.locator(`[data-jack="${put}"] [data-dir="in"]`)).toHaveAttribute('fill', '#0A0D11')
  // Show: Connected (the default) leaves out a jack no cord touches; All shows it
  await expect(w.locator(`[data-jack="${idle}"]`)).toHaveCount(0)
  await w.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All' }).click()
  await expect(w.locator(`[data-jack="${idle}"]`)).toHaveCount(1)
  await w.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Connected' }).click()
  await w.getByRole('button', { name: 'Back', exact: true }).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: test.info().outputPath('rack.png') })
  await w.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All' }).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: test.info().outputPath('rack-all.png') })
})
