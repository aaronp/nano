import { expect, test } from 'bun:test'
import { appUrl } from './app-url'

test('the app root is the base without its docs/', () => {
  expect(appUrl('/docs/', 'examples/slice/nano.json')).toBe('/?src=examples/slice/nano.json')
  expect(appUrl('/nano/docs/', 'examples/template/nano.json')).toBe('/nano/?src=examples/template/nano.json')
})
