import { expect, test } from 'claude-code/testing'

import { dropEntries, dropNamedSections, dropSections, dropTools, mentionsPlugin, parseMcpList, setDenied, setEntries } from '../hooks/lists'

test('hidden skills and a hidden plugin leave the list, the rest stay', async () => {
  const listing = [
    'The following skills are available for use with the Skill tool:',
    '',
    '- humanizer: Rewrite AI-sounding text.',
    '- claude-api: Reference for the Claude API.',
    'TRIGGER: read BEFORE opening the target file',
    '- gsap-skills:gsap-core',
    '- frontend-design:frontend-design: Guidance for design.',
    '- watch: Watch a video.',
  ].join('\n')
  const isHidden = (name: string) =>
    ['humanizer', 'claude-api'].includes(name) || name.startsWith('gsap-skills:')

  expect(dropEntries(listing, isHidden)).toBe([
    'The following skills are available for use with the Skill tool:',
    '',
    '- frontend-design:frontend-design: Guidance for design.',
    '- watch: Watch a video.',
  ].join('\n'))
})

test("a hidden plugin's tool-server section goes, others stay", async () => {
  const notes = '# MCP Server Instructions\n\n## plugin:productivity:slack\nSlack notes\n## fal-ai\nfal notes'
  expect(dropSections(notes, ['productivity'])).toBe('# MCP Server Instructions\n\n## fal-ai\nfal notes')
})

test('hook text matches a plugin only as a word of its own', async () => {
  expect(mentionsPlugin('use superpowers:brainstorming first', 'superpowers')).toBe(true)
  expect(mentionsPlugin('metadata: none', 'data')).toBe(false)
  expect(mentionsPlugin('see frontend-design:frontend-design', 'design')).toBe(false)
})

test('a settings edit keeps every other key and entry', async () => {
  const settings = {
    permissions: { allow: ['Bash(ls)'] },
    enabledPlugins: { 'a@m': true, 'b@m': true },
  }
  const next = setEntries(settings, 'enabledPlugins', { 'a@m': false, 'b@m': undefined, 'c@m': true })
  expect(next).toEqual({
    permissions: { allow: ['Bash(ls)'] },
    enabledPlugins: { 'a@m': false, 'c@m': true },
  })
  // The input is left as it was.
  expect(settings.enabledPlugins).toEqual({ 'a@m': true, 'b@m': true })
})

test('a hidden server leaves the tool list, others stay', async () => {
  const tools = 'The following tools just became available:\nmcp__claude_ai_Canva__design\nmcp__fal-ai__run_model\nmcp__claude_ai_Gmail__send'
  expect(dropTools(tools, ['claude.ai Canva', 'fal-ai'])).toBe('The following tools just became available:\nmcp__claude_ai_Gmail__send')
  expect(dropNamedSections('# MCP\n\n## fal-ai\nfal notes\n## hostinger\nnotes', ['fal-ai'])).toBe('# MCP\n\n## hostinger\nnotes')
})

test('server names are read from claude mcp list, plugin servers left out', async () => {
  const out = [
    'Checking MCP server health…',
    '',
    'claude.ai Canva: https://mcp.canva.com/mcp - ✔ Connected',
    'plugin:productivity:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication',
    'fal-ai: https://mcp.fal.ai/mcp (HTTP) - ✔ Connected',
    'chrome-devtools: npx -y chrome-devtools-mcp@latest - ✔ Connected',
  ].join('\n')
  expect(parseMcpList(out)).toEqual(['claude.ai Canva', 'fal-ai', 'chrome-devtools'])
})

test('the deny list gains and loses servers, keeping other entries', async () => {
  const settings = { model: 'x', deniedMcpServers: [{ serverName: 'keep' }] }
  const off = setDenied(settings, ['fal-ai'], true)
  expect(off).toEqual({ model: 'x', deniedMcpServers: [{ serverName: 'keep' }, { serverName: 'fal-ai' }] })
  expect(setDenied(off, ['fal-ai'], false)).toEqual(settings)
})
