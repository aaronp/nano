// Browser tests (`make test-ui`): the host app and the template package, each on its own origin, in your Chrome.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',   // not *.spec.ts / *.test.ts, which `bun test` would pick up
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3000', channel: 'chrome', trace: 'retain-on-failure' },
  webServer: [
    { command: 'make ui', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 120_000 },
    { command: 'make serve-template', url: 'http://localhost:5174/manifest.json', reuseExistingServer: true, timeout: 120_000 },
  ],
})
