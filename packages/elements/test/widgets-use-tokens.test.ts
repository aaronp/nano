// The widgets built on this library take their colours from the --nano-* tokens (a literal colour may only be a
// token's fallback), so they follow the host's theme.
import { expect, test } from 'bun:test'
import { join } from 'node:path'

const root = join(import.meta.dir, '../..')
const WIDGETS = ['bundle/src/elements/elements.ts', 'bundle/src/elements/debounce-el.ts', 'bundle/src/elements/debounce-model.ts', 'platform/src/view.ts',
  'editor/src/elements/connection-board-el.ts', 'editor/src/elements/type-editor-el.ts', 'editor/src/elements/editor-page.ts',
  ...['select', 'calendar', 'overlays', 'data-table'].map(f => `elements/src/kit/${f}.ts`), 'elements/src/agent/parts.ts', 'elements/src/agent/timeline.ts']   // (editor/src/model/looks.ts holds data colours: a type's chosen swatch, the same in every theme)

test('no widget uses a colour except as a --nano-* fallback', async () => {
  for (const f of WIDGETS) {
    const text = (await Bun.file(join(root, f)).text()).replace(/var\(--nano-[a-z0-9-]+, *[^)]*\)/g, '').replace(/v\('[a-z0-9-]+', *'[^']*'\)/g, '')
    expect(text.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(/g), f).toBeNull()
  }
})
