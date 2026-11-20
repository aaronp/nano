// Another tab writes the pages: this tab saves no more (platform-boot-tabs-setup.ts).
import { test } from 'bun:test'
import { anotherTab, PAGES } from './platform-boot-tabs-setup.ts'

test('pagehide flushes a pending save; a write from another tab to the pages stops saving here and says so', () => anotherTab(PAGES))
