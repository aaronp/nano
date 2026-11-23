// Another tab writes the document: this tab saves no more (outline-boot-tabs-setup.ts).
import { test } from 'bun:test'
import { anotherTab, KEY } from './outline-boot-tabs-setup.ts'

test('a write from another tab to the host document stops saving here and says so', () => anotherTab(KEY))
