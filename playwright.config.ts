// Browser tests (`make test-ui`): the host app, in your Chrome.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',   // not *.spec.ts / *.test.ts, which `bun test` would pick up
  timeout: 60_000,
  // ports of their own, never reused: a server already on 3000 (any app) would otherwise be tested instead
  use: { baseURL: 'http://localhost:3210', channel: 'chrome', trace: 'retain-on-failure' },
  webServer: [
    { command: 'make ui PORT=3210', url: 'http://localhost:3210', reuseExistingServer: false, timeout: 120_000 },
    // the template on another origin, for a cross-origin import; a `make serve-template` already running is reused (same files)
    { command: 'make serve-template TEMPLATE_PORT=5174', url: 'http://localhost:5174/nano.json', reuseExistingServer: true, timeout: 120_000 },
  ],
})
