// The kit stylesheet: the CSS-only pieces (avatar, bubble, kbd, input group, toggle, switch, dialog, drawer, popover,
// menu, toast), in shadcn's look, through the --nano-* tokens only.
import { expect, test } from 'bun:test'
import { kit } from '../src'

const cssText = kit.cssText

test('the kit has its classes', () => {
  for (const c of ['.avatar', '.avatar-stack', '.bubble', '.bubble.mine', '.kbd', '.input-group', '.addon', '.toggle', '.toggle-group', '.switch',
    'dialog.dialog', 'dialog.drawer', '.drawer.bottom', '::backdrop', '.pop', '.menu-item', '.menu-sep', '.shortcut', '.toast', '.code'])
    expect(cssText, c).toContain(c)
})

test('the kit uses no colour except through a token', () => {
  const withoutTokens = cssText.replace(/var\(--nano-[a-z0-9-]+, [^)]*\)/g, '')
  expect(withoutTokens.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)).toBeNull()
})
