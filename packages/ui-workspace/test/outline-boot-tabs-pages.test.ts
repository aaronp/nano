// Another tab writes an old key (a workspace not yet on the host core): this tab saves no more (outline-boot-tabs-setup.ts).
import { test } from 'bun:test'
import { anotherTab, OLD } from './outline-boot-tabs-setup.ts'

test('a write from another tab to an old key stops saving here and says so', () => anotherTab(OLD))
