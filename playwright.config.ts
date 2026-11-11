// Browser tests (`make test-ui`): the host app and the template package, each on its own origin, in your Chrome.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',   // not *.spec.ts / *.test.ts, which `bun test` would pick up
  timeout: 60_000,
  // ports of their own, never reused: a server already on 3000 (any app) would otherwise be tested instead
  use: { baseURL: 'http://localhost:3210', channel: 'chrome', trace: 'retain-on-failure' },
  webServer: [
    { command: 'make ui PORT=3210', url: 'http://localhost:3210', reuseExistingServer: false, timeout: 120_000 },
    { command: 'make serve-template TEMPLATE_PORT=5210', url: 'http://localhost:5210/manifest.json', reuseExistingServer: false, timeout: 120_000 },
  ],
})
