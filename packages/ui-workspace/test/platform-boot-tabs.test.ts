// Another tab writes the document: this tab saves no more (platform-boot-tabs-setup.ts).
import { test } from 'bun:test'
import { anotherTab, KEY } from './platform-boot-tabs-setup.ts'

test('pagehide flushes a pending save; a write from another tab to the document stops saving here and says so', () => anotherTab(KEY))
