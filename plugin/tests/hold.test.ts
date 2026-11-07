import { expect, test } from 'claude-code/testing'

// The engine beneath, stubbed: every call the mod makes at start is answered.
function stubEngine(on: any) {
  on('command.register', () => ({ value: { command: 'session-kit' } }))
  on('command.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.messages', () => ({ value: [] }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
}

test('with the desktop window attached after start, the first message is still refused', async ($, on) => {
  stubEngine(on)
  let reachedClaude = false
  on('prompt.submit', (_: unknown, e: any) => {
    reachedClaude = true
    return { text: e.text }
  })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  // As in the desktop app: the session starts before its window attaches.
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  const result: any = await $.prompt.submit({ text: 'hello' })
  expect(typeof result.drop).toBe('string')
  expect(reachedClaude).toBe(false)
})

test('with no screen (a -p run) the first message goes straight through', async ($, on) => {
  stubEngine(on)
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('session.surfaces', () => ({ value: [] }))
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  const result: any = await $.prompt.submit({ text: 'hello' })
  expect(result.text).toBe('hello')
})
