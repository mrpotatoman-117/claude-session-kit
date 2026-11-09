import { expect, test } from 'claude-code/testing'

import { dropEntries, dropNamedSections, dropSections, dropTools, groupFamilies, historyFolder, matchesSearch, mentionsPlugin, nextPresetName, parseMcpList, parsePresets, parseSkillLock, presetChanges, renamePreset, setDenied, setEntries, usedPreset } from '../hooks/lists'

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

test("a project's history folder is its path with every other character as a dash", async () => {
  expect(historyFolder('/Users/me/My Drive/Claude_Code/Session.Kit@x')).toBe('-Users-me-My-Drive-Claude-Code-Session-Kit-x')
})

test('the used preset turns on what the project used and off the rest, leaving MCP alone', async () => {
  const items = [
    { key: 'plugin:superpowers@x', kind: 'plugin', projectUses: 4 },
    { key: 'plugin:gsap@x', kind: 'plugin', projectUses: 0 },
    { key: 'skill:humanizer', kind: 'skill', projectUses: 1 },
    { key: 'mcp:fal-ai', kind: 'mcp', projectUses: 0 },
    { key: 'skill:uncounted', kind: 'skill' },
  ]
  expect(usedPreset(items)).toEqual({ 'plugin:superpowers@x': true, 'plugin:gsap@x': false, 'skill:humanizer': true })
  // A project with no history gets no preset rather than everything off.
  expect(usedPreset([{ key: 'skill:a', kind: 'skill', projectUses: 0 }])).toEqual({})
})

test('a preset stages only the switches that change and items that still exist', async () => {
  const current = { 'plugin:a': true, 'plugin:b': false, 'skill:c': true }
  const preset = { 'plugin:a': true, 'plugin:b': true, 'skill:c': false, 'skill:gone': true }
  expect(presetChanges(current, preset)).toEqual({ 'plugin:b': true, 'skill:c': false })
})

test('a new preset takes the first free number', async () => {
  expect(nextPresetName([])).toBe('Preset 1')
  expect(nextPresetName(['Preset 1', 'Preset 3', 'Design'])).toBe('Preset 2')
})

test('a damaged presets file loses only what is damaged', async () => {
  expect(parsePresets('not json')).toEqual({})
  expect(parsePresets('[1]')).toEqual({})
  expect(parsePresets('{"Web":{"plugin:a":true,"skill:b":"on"},"Bad":3}')).toEqual({ Web: { 'plugin:a': true } })
})

test('a rename keeps the preset and its place, and never overwrites another', async () => {
  const presets = { Web: { 'plugin:a': true }, Video: { 'plugin:b': false } }
  const renamed = renamePreset(presets, 'Web', 'Sites')
  expect(Object.keys(renamed)).toEqual(['Sites', 'Video'])
  expect(renamed.Sites).toEqual({ 'plugin:a': true })
  expect(() => renamePreset(presets, 'Web', 'Video')).toThrow()
  expect(() => renamePreset(presets, 'Gone', 'X')).toThrow()
})

test('search matches every word, in any order and case, across name and description', async () => {
  const texts = ['claude-seo', 'Comprehensive SEO analysis for any website']
  expect(matchesSearch('', texts)).toBe(true)
  expect(matchesSearch('SEO', texts)).toBe(true)
  expect(matchesSearch('website seo', texts)).toBe(true)
  expect(matchesSearch('seo video', texts)).toBe(false)
})

test('a skills lock gives each skill its repo as family, and a damaged one gives none', async () => {
  const lock = JSON.stringify({ skills: { brandkit: { source: 'Leonxlnx/taste-skill' }, watch: { source: 'bradautomates/claude-video' }, odd: {} } })
  expect(parseSkillLock(lock)).toEqual({ brandkit: 'taste-skill', watch: 'claude-video' })
  expect(parseSkillLock('not json')).toEqual({})
})

test('a family takes the place of its first member; a family of one stays a plain row', async () => {
  const family: Record<string, string> = { a: 'taste', c: 'taste', d: 'solo' }
  const rows = groupFamilies(['a', 'b', 'c', 'd'], name => family[name])
  expect(rows).toEqual([{ family: 'taste', members: ['a', 'c'] }, { item: 'b' }, { item: 'd' }])
})
