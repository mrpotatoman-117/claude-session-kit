import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Item, Kit, Scope, Sort } from '../types'
import { dropEntries, dropNamedSections, dropSections, dropTools, historyFolder, mcpPrefix, mentionsPlugin, nextPresetName, parseMcpList, parsePresets, presetChanges, renamePreset, setDenied, setEntries, usedPreset } from './lists'
import type { Preset } from './lists'

// One pane per session listing every installed plugin and personal skill,
// each with an On/Off button. Presses are staged; Apply carries them out at
// one of three scopes:
// - this session: the item is cut from the lists Claude reads at the start
//   (skills, agents, tool-server notes, start-of-session hook text); nothing
//   is saved. Those lists are sent once, with the first message, so that
//   message is refused (as cache-tax refuses a cold send) and sent again by
//   Apply and start.
// - this project: .claude/settings.local.json, which outranks the account.
// - all projects: ~/.claude/settings.json, clearing this project's own entry.
// Saved changes unload the item fully, from the next session.

const PANE = 'session-kit'
// Change the shape tag when Kit's fields change: it declines a value an
// earlier version kept, which outlives a reload.
const kit = atom(
  { plugin: 'session-kit', key: 'kit' } as const,
  {
    root: '',
    items: [],
    status: 'Loading...',
    sort: 'name',
    scope: 'session',
    tab: 'plugin',
    hidden: [],
    pending: {},
    isStarted: false,
    held: '',
    preset: '',
    presets: {},
    naming: null,
    isConfirmingDelete: false,
    isMinimized: false,
  } as Kit,
  { shape: 'kit-6' },
)

// A short record of start-up, first-message and save decisions, kept beside
// the mod and shared by every session, so a save that silently did nothing
// can be explained afterwards.
async function trace($: Engine, line: string) {
  const path = `${$.plugin.root}/trace.log`
  try {
    const before = (await $.fs.exists(path)) ? (await $.fs.read(path)).split('\n').filter(Boolean) : []
    const session = (await $.session.id()).slice(0, 8)
    before.push(`${new Date().toISOString()} ${session} ${line}`)
    await $.fs.write(path, before.slice(-200).join('\n') + '\n')
  } catch {
    // tracing never gets in the way
  }
}

const keyOf = (item: Item) => `${item.kind}:${item.id}`
const nameOf = (item: Item) => item.id.split('@')[0] ?? item.id

// The dropdown's value for the preset worked out from this project's history.
const USED = 'used'

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'session', label: 'This session only' },
  { value: 'project', label: 'This project' },
  { value: 'global', label: 'All projects' },
]

type Json = Record<string, any>

// Plain names for where a plugin came from; any other marketplace shows as is.
const SOURCES: Record<string, string> = {
  synced: 'from claude.ai',
  'local-mods': 'your mods',
  'claude-plugins-official': 'Anthropic',
}

// Cost levels, in always-on tokens per session. A single heavy plugin (2k+)
// costs as much as a dozen light ones, which is what the red is for.
const LIGHT = 500
const HEAVY = 2000
const LEVEL = (n: number) => (n >= HEAVY ? 'error' : n >= LIGHT ? 'warning' : 'success')

// Pill colours for the SVG badge: muted, warm tones in Claude's palette
// (sage, honey, clay), each with a dark ink of the same hue at 6:1 or better,
// so they read on the light and the dark app alike.
const PILL = {
  success: { fill: '#A9CC94', ink: '#1E3A14' },
  warning: { fill: '#F2C25E', ink: '#3D2B04' },
  error: { fill: '#F29878', ink: '#5A1A08' },
} as const

function pillSvg(text: string, width: number, fill: string, ink: string) {
  const safe = text.replace(/[<>&"]/g, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" viewBox="0 0 ${width} 20">` +
    `<rect width="${width}" height="20" rx="10" fill="${fill}"/>` +
    `<text x="${width / 2}" y="14" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" ` +
    `font-size="12" font-weight="600" fill="${ink}">${safe}</text></svg>`
}

// 640, 4.7k, 31k: short enough to scan down a column.
function tokens(n: number) {
  if (n < 1000) return `~${n}`
  return `~${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`
}

async function readJson($: Engine, path: string): Promise<Json | undefined> {
  if (!(await $.fs.exists(path))) return {}
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return undefined // unreadable: never overwrite it
  }
}

async function claudeBin($: Engine, home: string) {
  const local = `${home}/.local/bin/claude`
  return (await $.fs.exists(local)) ? local : 'claude'
}

// The description in a SKILL.md front matter, which is what every session
// carries for a skill. Handles plain, quoted and block (| or >) values.
function frontDescription(text: string) {
  const front = text.split('---')[1] ?? ''
  const field = front.split(/\n(?=[a-zA-Z-]+:)/).find(l => l.startsWith('description:')) ?? ''
  return field
    .replace(/^description:\s*[|>]?-?/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["']|["']$/g, '')
}

// About 4 characters per token, plus the name and framing around it.
function skillTokens(text: string) {
  return Math.max(10, Math.round(frontDescription(text).length / 4) + 10)
}

// The first sentence, so a row stays one line that says what the thing is for.
function oneLine(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? clean
}

// A plugin's description, or its first skill's when it ships no manifest.
async function pluginAbout($: Engine, dir: string) {
  const manifest = await readJson($, `${dir}/.claude-plugin/plugin.json`)
  if (manifest?.description) return oneLine(manifest.description)
  if (!(await $.fs.exists(`${dir}/skills`))) return ''
  for (const skill of await $.fs.list(`${dir}/skills`)) {
    const file = `${dir}/skills/${skill.name}/SKILL.md`
    if (await $.fs.exists(file)) return oneLine(frontDescription(await $.fs.read(file)))
  }
  return ''
}

async function load($: Engine) {
  const home = (await $.env.get('HOME')) ?? ''
  const root = await $.session.root()
  const user = (await readJson($, `${home}/.claude/settings.json`)) ?? {}
  const shared = (await readJson($, `${root}/.claude/settings.json`)) ?? {}
  const local = (await readJson($, `${root}/.claude/settings.local.json`)) ?? {}
  const pick = (key: string) => ({
    ...(user[key] ?? {}),
    ...(shared[key] ?? {}),
    ...(local[key] ?? {}),
  })
  const plugins: Json = pick('enabledPlugins')
  const skills: Json = pick('skillOverrides')
  const items: Item[] = []

  // Installed plugins: account-wide ones, plus project ones for this folder.
  const installed = (await readJson($, `${home}/.claude/plugins/installed_plugins.json`)) ?? {}
  for (const [id, entries] of Object.entries<any[]>(installed.plugins ?? {})) {
    const entry = entries.find(e => e.scope === 'user' || e.projectPath === root)
    if (!entry) continue
    items.push({
      kind: 'plugin',
      id,
      on: plugins[id] === true,
      isOverridden: id in (local.enabledPlugins ?? {}),
      version: entry.version,
      about: await pluginAbout($, entry.installPath),
    })
  }

  // Plugins synced from claude.ai: on unless a setting turns them off. With
  // no setting, what loaded in this session is the best answer.
  const loaded = new Set((await $.command.list()).map((c: { plugin?: string }) => c.plugin).filter(Boolean))
  const syncRoot = `${home}/.claude/plugins/synced`
  if (await $.fs.exists(syncRoot)) {
    for (const account of await $.fs.list(syncRoot)) {
      if (account.kind !== 'dir') continue
      for (const dir of await $.fs.list(`${syncRoot}/${account.name}`)) {
        const manifest = await readJson($, `${syncRoot}/${account.name}/${dir.name}/.claude-plugin/plugin.json`)
        if (!manifest?.name) continue
        const id = `${manifest.name}@synced`
        // The sync folder can hold a plugin twice (by id and by name).
        if (items.some(i => i.id === id)) continue
        items.push({
          kind: 'plugin',
          id,
          on: id in plugins ? plugins[id] === true : loaded.has(manifest.name),
          isOverridden: id in (local.enabledPlugins ?? {}),
          version: manifest.version,
          about: await pluginAbout($, `${syncRoot}/${account.name}/${dir.name}`),
        })
      }
    }
  }

  // Personal skills in ~/.claude/skills: on unless skillOverrides says off.
  const skillDirs = (await $.fs.exists(`${home}/.claude/skills`)) ? await $.fs.list(`${home}/.claude/skills`) : []
  for (const dir of skillDirs) {
    const file = `${home}/.claude/skills/${dir.name}/SKILL.md`
    if (dir.kind === 'file' || !(await $.fs.exists(file))) continue
    const text = await $.fs.read(file)
    items.push({
      kind: 'skill',
      id: dir.name,
      on: skills[dir.name] !== 'off',
      isOverridden: dir.name in (local.skillOverrides ?? {}),
      tokens: skillTokens(text),
      about: oneLine(frontDescription(text)),
    })
  }

  // MCP servers, from the last `claude mcp list` (refreshed in the background
  // below). Deny lists join across settings files, so any one turns it off.
  const denied = new Set(
    [user, shared, local].flatMap(s => (s.deniedMcpServers ?? []).map((d: { serverName?: string }) => d.serverName)),
  )
  const localDenied = new Set((local.deniedMcpServers ?? []).map((d: { serverName?: string }) => d.serverName))
  // Servers connect a few seconds after a session starts, so a cost is
  // measured whenever its tools are there and remembered for the next look.
  const tools = await $.tool.list()
  const seen = ((await $.store.get('mcp-costs')) as Record<string, { tokens: number; count: number }> | undefined) ?? {}
  for (const server of ((await $.store.get('mcp-servers')) as string[] | undefined) ?? []) {
    const own = tools.filter(t => t.name.startsWith(mcpPrefix(server)))
    // shortcut: counts only the tool names Claude is listed, not each tool's
    // schema, which loads on use.
    if (own.length) seen[server] = { tokens: Math.round(own.reduce((n, t) => n + t.name.length, 0) / 4) + own.length * 2, count: own.length }
    items.push({
      kind: 'mcp',
      id: server,
      on: !denied.has(server),
      isOverridden: localDenied.has(server),
      tokens: seen[server]?.tokens,
      about: seen[server] ? `${seen[server].count} tools` : 'Not connected yet, so its cost is not known.',
    })
  }
  await $.store.set('mcp-costs', seen)

  items.sort((a, b) => a.id.localeCompare(b.id))
  // A reload must not drop the plugin costs and usage counts the background
  // scans already filled in: they would not be fetched again while it runs.
  await update($, kit, k => {
    const before = new Map(k.items.map(i => [keyOf(i), i]))
    const merged = items.map(i => {
      const old = before.get(keyOf(i))
      return { ...i, tokens: i.tokens ?? old?.tokens, uses: i.uses ?? old?.uses, projectUses: old?.projectUses }
    })
    return { ...k, root, items: merged, status: k.status === 'Loading...' ? '' : k.status }
  })
  await loadPresets($, root)
  if (!isScanning) {
    isScanning = true
    void Promise.all([loadCosts($, home), loadUsage($, home), loadServers($, home)]).finally(() => {
      isScanning = false
    })
  }
}

// How many past sessions used each thing, read from the session transcripts
// in ~/.claude/projects: skill calls, slash commands and subagent types. A
// session counts once however often it used the thing; helper-agent
// transcripts (subagents/) are part of their session, not sessions of their own.
const USAGE_SCRIPT = String.raw`grep -r -o --include='*.jsonl' --exclude-dir=subagents -E '"name":"Skill","input":\{"skill":"[^"]+"|<command-name>/?[^<]+</command-name>|"subagent_type":"[^"]+"' . 2>/dev/null | sed -E 's#^([^:]+):.*("skill":"|<command-name>/?|"subagent_type":")([^"<]+).*#\1\t\3#' | sort -u | cut -f2 | sort | uniq -c`

// Uses per name in the transcripts under one folder; undefined when there
// is no readable history there.
async function countUses($: Engine, dir: string) {
  if (!(await $.fs.exists(dir))) return undefined
  const counts = new Map<string, number>()
  try {
    const run = await $.process.run(['sh', '-c', USAGE_SCRIPT], { cwd: dir, timeoutMs: 60000 })
    for (const line of run.stdout.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/)
      if (match?.[1] && match[2]) counts.set(match[2], Number(match[1]))
    }
  } catch {
    return undefined
  }
  return counts
}

async function loadUsage($: Engine, home: string) {
  // Read the folder now: the desktop app may have moved the session from a
  // spare folder to its project since start-up.
  const root = await $.session.root()
  const [all, project] = await Promise.all([
    countUses($, `${home}/.claude/projects`),
    root.includes('/.claude/spares/') ? undefined : countUses($, `${home}/.claude/projects/${historyFolder(root)}`),
  ])
  if (!all) return // no history readable: the pane simply shows no usage
  // A skill by its name; a plugin by everything it namespaces ("name:...").
  const usesOf = (counts: Map<string, number>, item: Item) => {
    const name = nameOf(item)
    if (item.kind === 'skill') return counts.get(name) ?? 0
    let sum = counts.get(name) ?? 0
    for (const [key, n] of counts) if (key.startsWith(`${name}:`)) sum += n
    return sum
  }
  await update($, kit, k => ({
    ...k,
    items: k.items.map(i => ({ ...i, uses: usesOf(all, i), projectUses: project && usesOf(project, i) })),
  }))
}

const presetsFile = (root: string) => `${root}/.claude/session-kit-presets.json`

async function loadPresets($: Engine, root: string) {
  const path = presetsFile(root)
  const presets = (await $.fs.exists(path)) ? parsePresets(await $.fs.read(path)) : {}
  await update($, kit, k => ({ ...k, presets }))
}

// Changes this project's presets file: read fresh, so a save in another
// session is not lost, then written whole. `chosen` is the preset the menu
// shows afterwards; `done` is the status line.
async function editPresets(
  $: Engine,
  change: (presets: Record<string, Preset>) => Record<string, Preset>,
  chosen: string,
  done: string,
) {
  const root = await $.session.root()
  if (root.includes('/.claude/spares/')) {
    void $.ui.toast('Not saved: this session has not reached its project folder yet. Try again in a moment.')
    return
  }
  const path = presetsFile(root)
  try {
    const before = (await $.fs.exists(path)) ? await $.fs.read(path) : '{}'
    // A file that is there but unreadable is left alone, not overwritten.
    try {
      JSON.parse(before)
    } catch {
      throw new Error(`${path} is not valid JSON, so it was left alone.`)
    }
    const presets = change(parsePresets(before))
    await $.fs.write(path, JSON.stringify(presets, null, 2) + '\n')
    await update($, kit, k => ({ ...k, presets, preset: chosen ? `saved:${chosen}` : '', naming: null, isConfirmingDelete: false, status: done }))
  } catch (err) {
    void $.ui.toast(`Preset not changed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const savePreset = ($: Engine, name: string, preset: Preset) =>
  editPresets($, presets => ({ ...presets, [name]: preset }), name, `Saved preset "${name}" for this project.`)

const renameSaved = ($: Engine, from: string, to: string) =>
  editPresets($, presets => renamePreset(presets, from, to), to, `Renamed "${from}" to "${to}".`)

const deleteSaved = ($: Engine, name: string) =>
  editPresets($, presets => Object.fromEntries(Object.entries(presets).filter(([n]) => n !== name)), '', `Deleted preset "${name}".`)

// Folding the pane is remembered across sessions, like the scope.
// A docked pane keeps the size the app gives it, so minimizing closes the
// pane; /session-kit opens it again. Not kept across sessions, since a new
// session would then start with no panel in sight.
async function setMinimized($: Engine, isMinimized: boolean) {
  await update($, kit, k => ({ ...k, isMinimized }))
  if (isMinimized) {
    await $.ui.close({ id: PANE })
    // The command is the only way back, so it is said every time.
    void $.ui.toast('Session kit minimized. Type /session-kit to bring it back.')
  } else await open($)
}

const SORTS: { value: Sort; label: string }[] = [
  { value: 'name', label: 'Name, A to Z' },
  { value: 'cost', label: 'Most tokens' },
  { value: 'used', label: 'Most used' },
  { value: 'unused', label: 'Unused first' },
  { value: 'on', label: 'On first' },
  { value: 'off', label: 'Off first' },
]

// Each sort puts its own question first and falls back to the name, so
// rows never shuffle among equals.
function compare(sort: Sort, isOn: (i: Item) => boolean) {
  const key = (i: Item): number => {
    switch (sort) {
      case 'cost': return -(i.tokens ?? -1)
      case 'used': return -(i.uses ?? 0)
      case 'unused': return i.uses ?? 0
      case 'on': return isOn(i) ? 0 : 1
      case 'off': return isOn(i) ? 1 : 0
      default: return 0
    }
  }
  return (a: Item, b: Item) => key(a) - key(b) || a.id.localeCompare(b.id)
}

function usage(n: number | undefined) {
  if (n === undefined) return ''
  if (n === 0) return 'never used'
  return `used in ${n} session${n === 1 ? '' : 's'}`
}

// The MCP server list comes from `claude mcp list`, which health-checks every
// server and takes a few seconds, so it runs after the pane is drawn and the
// names are kept for the next open. It reloads the list when done.
async function loadServers($: Engine, home: string) {
  try {
    const run = await $.process.run([await claudeBin($, home), 'mcp', 'list'], { timeoutMs: 60000 })
    const servers = parseMcpList(run.stdout)
    await $.store.set('mcp-servers', servers)
    // The check takes seconds; by its end the servers have connected, so a
    // reload now measures their costs, and picks up any new server name.
    await load($)
  } catch {
    // keep the last list
  }
}

// Plugin token costs come from `claude plugin details`, slow enough to run
// after the pane is drawn, and cached per version across sessions.
async function loadCosts($: Engine, home: string) {
  const bin = await claudeBin($, home)
  for (const item of (await read($, kit)).items) {
    if (item.kind !== 'plugin') continue
    const cacheKey = `cost:${item.id}@${item.version}`
    // null is a remembered "no cost known" (an unloaded claude.ai plugin).
    let tokens = (await $.store.get(cacheKey)) as number | null | undefined
    if (tokens === undefined) {
      try {
        const run = await $.process.run([bin, 'plugin', 'details', item.id], { timeoutMs: 30000 })
        const match = run.stdout.match(/Always-on:\s*~?([\d,]+)/)
        tokens = match?.[1] ? Number(match[1].replace(/,/g, '')) : null
        await $.store.set(cacheKey, tokens)
      } catch {
        continue // a timeout or crash is not remembered: try again next time
      }
    }
    if (tokens === null) continue
    await update($, kit, k => ({
      ...k,
      items: k.items.map(i => (i.id === item.id && i.kind === 'plugin' ? { ...i, tokens } : i)),
    }))
  }
}

// Edits one settings file in place, keeping every other key. Refuses to
// touch a file that is not valid JSON rather than overwrite it.
async function editSettings($: Engine, path: string, field: string, entries: Record<string, unknown>) {
  if (Object.keys(entries).length === 0) return
  const settings = await readJson($, path)
  if (!settings) throw new Error(`${path} is not valid JSON, so it was left alone.`)
  await $.fs.write(path, JSON.stringify(setEntries(settings, field, entries), null, 2) + '\n')
}

// Turns items on or off at the chosen scope: one press, or a whole section.
async function setItems($: Engine, items: Item[], turnOn: boolean) {
  const k = await read($, kit)
  const keys = new Set(items.map(keyOf))

  if (k.scope === 'session') {
    if (k.isStarted) {
      void $.ui.toast('This session has started. Choose This project or All projects instead.')
      return
    }
    if (turnOn && items.every(i => !i.on)) {
      void $.ui.toast('Not loaded in this session. Choose This project or All projects to turn it on from the next session.')
      return
    }
    await update($, kit, k => ({
      ...k,
      hidden: turnOn
        ? k.hidden.filter(h => !keys.has(h))
        : [...new Set([...k.hidden, ...items.filter(i => i.on).map(keyOf)])],
      status: '',
    }))
    return
  }

  const home = (await $.env.get('HOME')) ?? ''
  // Read the folder now, not at start-up: the desktop app starts a session in
  // a spare folder (~/.claude/spares/...) and moves it to the project later.
  const root = await $.session.root()
  if (root.includes('/.claude/spares/')) {
    void trace($, `save refused: still in spare folder ${root}`)
    void $.ui.toast('Not saved: this session has not reached its project folder yet. Try again in a moment.')
    return
  }
  const local = `${root}/.claude/settings.local.json`
  const shared = (await readJson($, `${root}/.claude/settings.json`)) ?? {}
  void trace($, `save: scope=${k.scope} turnOn=${turnOn} items=${items.length} root=${root}`)
  try {
    const servers = items.filter(i => i.kind === 'mcp').map(i => i.id)
    if (servers.length) {
      // Deny lists join across files: turning a server off adds it to the
      // chosen file's list; turning it on removes it from the chosen file and,
      // for all projects, from this project's file too.
      const deny = async (path: string) => {
        const settings = await readJson($, path)
        if (!settings) throw new Error(`${path} is not valid JSON, so it was left alone.`)
        await $.fs.write(path, JSON.stringify(setDenied(settings, servers, !turnOn), null, 2) + '\n')
      }
      await deny(k.scope === 'project' ? local : `${home}/.claude/settings.json`)
      if (k.scope === 'global' && turnOn) await deny(local)
    }
    for (const field of ['enabledPlugins', 'skillOverrides'] as const) {
      const group = items.filter(i => i.kind === (field === 'enabledPlugins' ? 'plugin' : 'skill'))
      // A plugin is true or false; a skill is "on" or "off".
      const value = field === 'enabledPlugins' ? turnOn : turnOn ? 'on' : 'off'
      if (k.scope === 'project') {
        await editSettings($, local, field, Object.fromEntries(group.map(i => [i.id, value])))
        continue
      }
      // An absent skill is on, so all projects drops the override to turn one on.
      const accountValue = field === 'skillOverrides' && turnOn ? undefined : value
      await editSettings($, `${home}/.claude/settings.json`, field, Object.fromEntries(group.map(i => [i.id, accountValue])))
      // This project's files outrank the account. Its personal entry is
      // cleared; where its shared file sets the item, the personal file must
      // carry the choice instead, since it outranks the shared one.
      await editSettings($, local, field, Object.fromEntries(
        group
          .filter(i => i.isOverridden || i.id in (shared[field] ?? {}))
          .map(i => [i.id, i.id in (shared[field] ?? {}) ? value : undefined]),
      ))
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    void trace($, `save failed: ${reason}`)
    void $.ui.toast(`Not saved: ${reason}`)
    return
  }
  void trace($, 'save done')
  await update($, kit, k => ({
    ...k,
    root,
    hidden: k.hidden.filter(h => !keys.has(h)),
    status: `Saved for ${k.scope === 'project' ? 'this project' : 'all projects'}. Applies from your next session.`,
    items: k.items.map(i =>
      keys.has(keyOf(i))
        ? { ...i, on: turnOn, isOverridden: i.kind === 'mcp' ? k.scope === 'project' && !turnOn : k.scope === 'project' || i.id in (shared[i.kind === 'plugin' ? 'enabledPlugins' : 'skillOverrides'] ?? {}) }
        : i,
    ),
  }))
}

// The cost and usage scans run in the background; a second open while they
// run would start them twice.
let isScanning = false

async function open($: Engine) {
  // Minimized, the band shows instead; the list still loads for its total.
  if (!(await read($, kit)).isMinimized) await $.ui.open({ id: PANE, title: 'Session kit' })
  try {
    await load($)
  } catch (err) {
    // Say what failed rather than show "Reading..." forever.
    const reason = err instanceof Error ? err.message : String(err)
    await update($, kit, k => ({ ...k, status: `Could not read your plugins and skills: ${reason}` }))
  }
}

// Carries out every staged press at the chosen scope. With andStart, before
// the first message, it then marks the session started and sends the held
// message on; without, the session stays open for more changes.
async function apply($: Engine, andStart: boolean) {
  const k = await read($, kit)
  void trace($, `apply: scope=${k.scope} staged=${Object.keys(k.pending).length} started=${k.isStarted} andStart=${andStart}`)
  if (Object.keys(k.pending).length === 0 && !(andStart && !k.isStarted)) {
    void $.ui.toast('Nothing to apply: press On, Off, All on or All off first.')
    return
  }
  const staged = k.items.filter(i => keyOf(i) in k.pending)
  const turnOn = staged.filter(i => k.pending[keyOf(i)])
  const turnOff = staged.filter(i => !k.pending[keyOf(i)])
  if (turnOn.length) await setItems($, turnOn, true)
  if (turnOff.length) await setItems($, turnOff, false)
  await update($, kit, k => ({ ...k, pending: {} }))
  if (andStart && !k.isStarted) await start($)
}

// The session's lists are fixed from here: send the held first message on,
// as the person's own words.
async function start($: Engine) {
  const { held } = await read($, kit)
  await update($, kit, k => ({
    ...k,
    isStarted: true,
    held: '',
    scope: k.scope === 'session' ? ('project' as const) : k.scope,
  }))
  if (held) await $.prompt.submit({ text: held, asUser: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-kit',
      description: 'Choose which plugins and skills load, for this session or saved',
    })
    // A resumed session, or this mod loading mid-conversation, has already
    // sent its lists: never hold its next message, and save changes instead.
    void trace($, `session.start: surface=${e.surface} root=${await $.session.root()}`)
    const scope = (await $.store.get('scope')) as Scope | undefined
    if (scope) await update($, kit, k => ({ ...k, scope }))
    if ((await $.session.messages()).some(m => m.role === 'user')) {
      await update($, kit, k => ({ ...k, isStarted: true, scope: 'project' as const }))
    }
    void open($)
    return next(e)
  })

  // The first message is refused and kept, so Claude reads nothing until
  // Apply and start: the session's lists go out with that first request. A
  // prompt from a plugin (our own resend included), a slash command, and any
  // session nobody is at a screen for pass straight through.
  on('prompt.submit', async ($, e, next) => {
    const k = await read($, kit)
    if (k.isStarted || e.command || e.origin?.kind === 'plugin') return next(e)
    if (e.text.trimStart().startsWith('/')) return next(e)
    // Asked now, not at start-up: the desktop app starts a session before its
    // window attaches, so at start-up nobody seems to be there.
    const surfaces = await $.session.surfaces()
    void trace($, `first message: surfaces=${surfaces.join(',') || 'none'}`)
    if (surfaces.length === 0) return next(e)
    // An image or file a plugin cannot resend: let this message through
    // rather than lose what was attached.
    if (e.attachments?.length) {
      await start($)
      return next(e)
    }
    // A minimized panel opens again: Apply and start is needed to send it.
    await update($, kit, k => ({ ...k, held: e.text, isMinimized: false }))
    void open($)
    return {
      drop: 'Session kit: choose what loads in the panel, then press Apply and start. Your message is kept and sends then. Closing the panel sends it as it is.',
    }
  })

  // Applies this session's hidden items to the lists Claude reads at the
  // start: skills, agents, tool-server notes and start-of-session hook text.
  on('prompt.attachment', async ($, e, next) => {
    const k = await read($, kit)
    if (k.hidden.length === 0 || !('text' in e) || typeof e.text !== 'string') return next(e)
    const hidden = k.items.filter(i => k.hidden.includes(keyOf(i)))
    const skills = hidden.filter(i => i.kind === 'skill').map(nameOf)
    const plugins = hidden.filter(i => i.kind === 'plugin').map(nameOf)
    const servers = hidden.filter(i => i.kind === 'mcp').map(i => i.id)
    const isHidden = (name: string) =>
      skills.includes(name) || plugins.some(p => name.startsWith(`${p}:`))

    if (e.type === 'skill_listing' || e.type === 'agent_listing_delta') {
      return next({ ...e, text: dropEntries(e.text, isHidden) })
    }
    if (e.type === 'mcp_instructions_delta') {
      return next({ ...e, text: dropNamedSections(dropSections(e.text, plugins), servers) })
    }
    if (e.type === 'deferred_tools_delta') {
      return next({ ...e, text: dropTools(e.text, servers) })
    }
    // Hook text names no plugin, so it is matched by the plugin's own
    // namespace ("superpowers:...") appearing in it.
    if (e.origin.kind === 'hook' && plugins.some(p => mentionsPlugin(e.text, p))) {
      return next({ ...e, text: '' })
    }
    return next(e)
  })

  // A server hidden for this session stays out of reach, not only out of sight.
  on('tool.call', async ($, e, next) => {
    const k = await read($, kit)
    const server = k.items.find(i => i.kind === 'mcp' && k.hidden.includes(keyOf(i)) && e.tool.startsWith(mcpPrefix(i.id)))
    if (server) return { deny: `${server.id} is turned off for this session in Session kit.` }
    return next(e)
  })

  // The desktop app's window attaches after the session starts: open the pane
  // for it before the first message.
  on('session.attach', async ($, e, next) => {
    const r = await next(e)
    void trace($, `attach: ${e.surface}`)
    if (!(await read($, kit)).isStarted) void open($)
    return r
  })

  // Closing the pane must not strand a held first message: it sends as it is.
  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    // Minimizing closes it too, and keeps the first message held.
    const k = await read($, kit)
    if (e.id === PANE && !k.isStarted && !k.isMinimized) await start($)
    return r
  })

  on('command.run', { command: 'session-kit' }, async $ => {
    await setMinimized($, false)
    return { text: 'Session kit opened.' }
  })


  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // A dropdown where the surface draws one (not yet the mobile app).
    const Select = 'Select' in elements ? elements.Select : undefined
    const pickSort = (value: string) => void update($, kit, k => ({ ...k, sort: value as Sort }))
    const k = await read($, kit)
    const { root, items, status, sort, scope, tab, hidden, pending, isStarted, held, preset, presets, naming, isConfirmingDelete } = k
    // A text field where the surface draws one (not yet the mobile app).
    const Input = 'Input' in elements ? elements.Input : undefined
    const project = root.split('/').pop() || root
    const isLoading = items.length === 0 && status === 'Loading...'
    // What Claude gets now: loaded by the settings and not hidden this session.
    const isOn = (item: Item) => item.on && !hidden.includes(keyOf(item))
    // What it will get once the staged presses are applied.
    const willBeOn = (item: Item) => pending[keyOf(item)] ?? isOn(item)
    const active = items.filter(willBeOn)
    const total = active.reduce((sum, i) => sum + (i.tokens ?? 0), 0)
    const changes = Object.keys(pending).length
    // Plugin costs arrive a few seconds after the list; until then the total
    // is a floor, and says so.
    const isCounting = active.some(i => i.kind === 'plugin' && i.tokens === undefined)
    // Once the first message has gone, this session's lists are fixed, so
    // the session scope is no longer offered rather than offered and refused.
    const scopes = isStarted ? SCOPES.filter(s => s.value !== 'session') : SCOPES
    const pickScope = (value: string) => {
      // Remembered for the next session, which would otherwise open on
      // This session only and leave a This project habit unsaved.
      void $.store.set('scope', value)
      void update($, kit, k => ({ ...k, scope: value as Scope, status: '' }))
    }
    const scopeNote = {
      session: 'Hides items from Claude for this session only. Nothing is saved.',
      project: `Saved for ${project}. Applies from your next session.`,
      global: 'Saved for every project. Applies from your next session.',
    }[scope]

    // A press only stages the change; Apply carries it out. Pressing an item
    // back to where it was un-stages it.
    const stage = (list: Item[], wanted: boolean) => {
      if (wanted && scope === 'session' && list.every(i => !i.on)) {
        void $.ui.toast('Not loaded in this session. Choose This project or All projects to turn it on from the next session.')
        return
      }
      void update($, kit, k => {
        const next = { ...k.pending }
        for (const i of list) {
          if (wanted && scope === 'session' && !i.on) continue
          if (wanted === (i.on && !k.hidden.includes(keyOf(i)))) delete next[keyOf(i)]
          else next[keyOf(i)] = wanted
        }
        return { ...k, pending: next, status: '' }
      })
    }

    // A picker: the native dropdown where the surface draws one, else a row
    // of buttons (the mobile app), the current one marked.
    const picker = (id: string, label: string, options: { value: string; label: string }[], value: string, pick: (v: string) => void) =>
      Select ? (
        <Select key={id} label={label} options={options} value={value} onSelect={pick} />
      ) : (
        <Box flexDirection="row" flexWrap="wrap" gap="sm">
          {options.map(o => (
            <Button
              key={`${id}:${o.value}`}
              label={o.label}
              variant={value === o.value ? 'primary' : 'secondary'}
              onPress={() => pick(o.value)}
            />
          ))}
        </Box>
      )

    // The cost as a small rounded pill, green, amber or red, so the heavy
    // items stand out before any number is read. Where the surface draws SVG
    // (the desktop app) it is a true pill with round ends; SVG is drawn as an
    // image and cannot follow the theme, so its colours are fixed ones that
    // read in light and dark. Elsewhere it falls back to a filled box.
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    const badge = (n: number | undefined, label?: string) => {
      if (n === undefined) return null
      const text = label ?? tokens(n)
      if (Svg) {
        const { fill, ink } = PILL[LEVEL(n)]
        const width = Math.round(text.length * 7 + 16)
        return (
          <Box flexShrink={0} flexGrow={0}>
            <Svg source={pillSvg(text, width, fill, ink)} alt={`${text} tokens`} width={width} height={20} />
          </Box>
        )
      }
      return (
        <Box backgroundColor={LEVEL(n)} paddingX="xs" flexShrink={0} flexGrow={0}>
          <Text size="footnote" weight="semibold" tabular color="inverseText" wrap="truncate-end">
            {text}
          </Text>
        </Box>
      )
    }

    // In the desktop app, claude.ai connectors are run by the app under their
    // own ids, beyond the reach of a settings deny list: its + menu switches them.
    const byApp = (item: Item) => item.kind === 'mcp' && e.surface === 'desktop' && item.id.startsWith('claude.ai ')

    // Each row, the settings-list pattern: the text takes the width (name and
    // cost pill, then its facts, then what it is for) and a short On/Off
    // switch sits fixed at the right edge, so every switch lines up.
    const row = (item: Item) => {
      const name = item.kind === 'mcp' ? item.id.replace(/^claude\.ai /, '') : nameOf(item)
      const isAppConnector = byApp(item)
      const source = item.id.split('@')[1] ?? ''
      const shown = willBeOn(item)
      const isStaged = keyOf(item) in pending
      // Off in the settings and session scope: it cannot be loaded now, so
      // the switch reads as inactive and a press explains why.
      const isStuck = scope === 'session' && !item.on
      const facts = [
        item.kind === 'skill'
          ? 'your skills'
          : item.kind === 'mcp'
            ? item.id.startsWith('claude.ai ') ? 'claude.ai connector' : 'MCP server'
            : SOURCES[source] ?? source,
        usage(item.uses),
        isStaged ? 'not applied yet' : hidden.includes(keyOf(item)) ? 'hidden this session' : '',
        item.isOverridden ? 'set for this project' : '',
      ].filter(Boolean)
      return (
        <Box flexDirection="row" alignItems="flex-start" gap="md">
          <Box flexDirection="column" flexGrow={1} flexShrink={1} rowGap="xs">
            <Box flexDirection="row" alignItems="center" gap="sm" flexWrap="wrap">
              <Text weight="medium" dimColor={!shown}>{name}</Text>
              {badge(item.tokens)}
            </Box>
            <Text size="footnote" dimColor={!isStaged} weight={isStaged ? 'semibold' : 'regular'} wrap="wrap">
              {facts.join(' · ')}
            </Text>
            <Text size="footnote" dimColor={!shown} wrap="wrap">
              {isAppConnector
                ? 'The desktop app runs this connector itself; switch it in the + menu, under Connectors.'
                : item.about || 'No description provided.'}
            </Text>
          </Box>
          <Box flexShrink={0}>
            {isAppConnector ? (
              <Text size="footnote" dimColor>Use + → Connectors</Text>
            ) : (
              <Button
                key={keyOf(item)}
                label={shown ? 'On' : 'Off'}
                variant={shown ? 'primary' : 'secondary'}
                dimColor={isStuck}
                onPress={() => stage([item], !shown)}
              />
            )}
          </Box>
        </Box>
      )
    }

    const list = items.filter(i => i.kind === tab).sort(compare(sort, willBeOn))
    // All off must not switch off this panel itself, nor reach connectors the
    // desktop app runs.
    const bulk = list.filter(i => nameOf(i) !== $.plugin.name && !byApp(i))
    const countOf = (kind: Item['kind']) => {
      const of = items.filter(i => i.kind === kind)
      return `${of.filter(willBeOn).length}/${of.length}`
    }

    // Presets never switch this panel itself, nor connectors the app runs.
    const presetable = items.filter(i => nameOf(i) !== $.plugin.name && !byApp(i))
    const used = usedPreset(presetable.map(i => ({ key: keyOf(i), kind: i.kind, projectUses: i.projectUses })))
    const presetOptions = [
      { value: '', label: 'No preset' },
      ...(Object.keys(used).length ? [{ value: USED, label: 'Used in this project' }] : []),
      ...Object.keys(presets).map(name => ({ value: `saved:${name}`, label: name })),
    ]
    const presetLabel = presetOptions.find(o => o.value === preset)?.label ?? ''
    // A preset stages its presses in place of any already staged, as a whole set.
    const pickPreset = (value: string) => {
      const chosen = value === USED ? used : presets[value.replace(/^saved:/, '')]
      if (!chosen) {
        void update($, kit, k => ({ ...k, preset: '', naming: null, isConfirmingDelete: false }))
        return
      }
      const current = Object.fromEntries(presetable.map(i => [keyOf(i), isOn(i)]))
      // This session only cannot load what the settings keep off.
      const notLoadable = new Set(items.filter(i => scope === 'session' && !i.on).map(keyOf))
      const changes = Object.fromEntries(
        Object.entries(presetChanges(current, chosen)).filter(([key, wanted]) => !(wanted && notLoadable.has(key))),
      )
      const n = Object.keys(changes).length
      void update($, kit, k => ({
        ...k,
        preset: value,
        pending: changes,
        naming: null,
        isConfirmingDelete: false,
        status: n ? `Preset staged: ${n} change${n === 1 ? '' : 's'}. Press Apply to carry them out.` : 'Already matches this preset.',
      }))
    }
    // What a save records: every switch as it will be once applied.
    const snapshot = () => Object.fromEntries(presetable.map(i => [keyOf(i), willBeOn(i)]))
    const startSaving = () => {
      const name = nextPresetName(Object.keys(presets))
      if (Input) void update($, kit, k => ({ ...k, naming: { mode: 'save' as const, text: name }, isConfirmingDelete: false }))
      else void savePreset($, name, snapshot())
    }
    // The saved preset the menu shows, which Update, Rename and Delete act on.
    const savedName = preset.startsWith('saved:') && preset.slice(6) in presets ? preset.slice(6) : ''
    const submitName = (text: string) => {
      const name = text.trim()
      if (!name) return void $.ui.toast('Type a name for the preset first.')
      if (naming?.mode === 'rename') void renameSaved($, savedName, name)
      else void savePreset($, name, snapshot())
    }
    const presetNote =
      naming?.mode === 'save'
        ? 'Saves every switch as it will be once applied. A name already used is replaced.'
        : naming?.mode === 'rename'
          ? `Renames "${savedName}". A name another preset has is refused.`
          : isConfirmingDelete
            ? `Delete "${savedName}" from this project? This cannot be undone. Your switches stay as they are.`
            : savedName
              ? 'To edit it, change the switches, then press Update to save them into this preset.'
              : 'Choosing a preset stages its switches; Apply carries them out at the scope below.'

    const applyStart = !isStarted ? (
      <Button key="apply-start" label="Apply and start" variant="primary" autoFocus onPress={() => void apply($, true)} />
    ) : null

    return (
      <Box flexDirection="column" paddingX="sm">
        <Box flexDirection="row" alignItems="flex-start" gap="md">
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="wrap">Choose what Claude loads when a session starts in {project}.</Text>
          </Box>
          <Button key="minimize" label="Minimize" variant="secondary" onPress={() => void setMinimized($, true)} />
        </Box>

        {isLoading ? (
          <Box marginTop="lg">
            <Text size="footnote" dimColor>Reading your plugins and skills...</Text>
          </Box>
        ) : (
          <>
            <Box flexDirection="column" marginTop="lg">
              <Text size="title" weight="semibold" tabular>
                {isCounting ? 'At least ' : ''}
                {tokens(total)} tokens
              </Text>
              <Text size="footnote" dimColor wrap="wrap">
                read at the start of each session, from the {active.length} items that {changes ? 'will be' : 'are'} on
                {isCounting ? '. Still counting plugin costs.' : ''}
              </Text>
            </Box>

            <Box flexDirection="column" marginTop="lg" rowGap="sm">
              {picker('preset', 'Preset', presetOptions, preset, pickPreset)}
              {naming && Input ? (
                <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="sm">
                  <Input
                    key={`preset-name:${naming.mode}`}
                    label={naming.mode === 'rename' ? 'New name' : 'Name'}
                    value={naming.text}
                    submitLabel={naming.mode === 'rename' ? 'rename' : 'save'}
                    autoFocus
                    onInput={v => void update($, kit, k => ({ ...k, naming: k.naming && { ...k.naming, text: v } }))}
                    onSubmit={submitName}
                  />
                  <Button key="preset-cancel" label="Cancel" variant="secondary" onPress={() => void update($, kit, k => ({ ...k, naming: null }))} />
                </Box>
              ) : isConfirmingDelete && savedName ? (
                <Box flexDirection="row" flexWrap="wrap" gap="sm">
                  <Button key="preset-delete-confirm" label={`Delete "${savedName}"`} variant="primary" onPress={() => void deleteSaved($, savedName)} />
                  <Button key="preset-delete-keep" label="Keep it" variant="secondary" onPress={() => void update($, kit, k => ({ ...k, isConfirmingDelete: false }))} />
                </Box>
              ) : (
                <Box flexDirection="row" flexWrap="wrap" gap="sm">
                  <Button key="preset-save" label="Save as preset" variant="secondary" onPress={startSaving} />
                  {savedName ? [
                      <Button key="preset-update" label="Update" variant="secondary" onPress={() => void savePreset($, savedName, snapshot())} />,
                      <Button
                        key="preset-rename"
                        label="Rename"
                        variant="secondary"
                        onPress={() =>
                          Input
                            ? void update($, kit, k => ({ ...k, naming: { mode: 'rename' as const, text: savedName } }))
                            : void $.ui.toast('Renaming needs a text field, which this app does not draw yet. Use the desktop app.')
                        }
                      />,
                      <Button key="preset-delete" label="Delete" variant="secondary" onPress={() => void update($, kit, k => ({ ...k, isConfirmingDelete: true }))} />,
                    ] : null}
                </Box>
              )}
              <Text size="footnote" dimColor={!isConfirmingDelete} weight={isConfirmingDelete ? 'semibold' : 'regular'} wrap="wrap">
                {presetNote}
              </Text>
            </Box>

            <Box flexDirection="column" marginTop="lg" rowGap="sm">
              {picker('scope', 'Apply to', scopes, scope, pickScope)}
              <Text size="footnote" dimColor wrap="wrap">{scopeNote}</Text>
            </Box>

            {!isStarted || changes ? (
              <Box flexDirection="column" marginTop="lg" rowGap="xs">
                <Box flexDirection="row" flexWrap="wrap" gap="sm">
                  {applyStart}
                  {changes ? (
                    <Button
                      key="apply"
                      label={`Apply ${changes} change${changes === 1 ? '' : 's'}`}
                      variant={isStarted ? 'primary' : 'secondary'}
                      onPress={() => void apply($, false)}
                    />
                  ) : null}
                  {changes ? (
                    <Button
                      key="discard"
                      label="Discard"
                      variant="secondary"
                      onPress={() => void update($, kit, k => ({ ...k, pending: {}, preset: '' }))}
                    />
                  ) : null}
                </Box>
                <Text size="footnote" weight={held ? 'semibold' : 'regular'} dimColor={!held} wrap="wrap">
                  {held
                    ? 'Your first message is kept. Apply and start sends it.'
                    : !isStarted
                      ? 'Apply saves your changes and keeps the session waiting. Apply and start also lets Claude begin; a message sent before then is kept and sent after.'
                      : `${changes} change${changes === 1 ? '' : 's'} not applied yet.`}
                </Text>
              </Box>
            ) : null}
            {status ? (
              <Box marginTop="sm">
                <Text size="footnote" weight="semibold" wrap="wrap">{status}</Text>
              </Box>
            ) : null}

            <Box flexDirection="row" flexWrap="wrap" gap="sm" marginTop="xl">
              <Button
                key="tab:plugin"
                label={`Plugins ${countOf('plugin')}`}
                variant={tab === 'plugin' ? 'primary' : 'secondary'}
                onPress={() => void update($, kit, k => ({ ...k, tab: 'plugin' as const }))}
              />
              <Button
                key="tab:skill"
                label={`Skills ${countOf('skill')}`}
                variant={tab === 'skill' ? 'primary' : 'secondary'}
                onPress={() => void update($, kit, k => ({ ...k, tab: 'skill' as const }))}
              />
              <Button
                key="tab:mcp"
                label={`MCP servers ${countOf('mcp')}`}
                variant={tab === 'mcp' ? 'primary' : 'secondary'}
                onPress={() => void update($, kit, k => ({ ...k, tab: 'mcp' as const }))}
              />
            </Box>

            <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="sm" marginTop="md">
              {picker('sort', 'Sort by', SORTS, sort, v => pickSort(v))}
              {bulk.length ? (
                <Box flexDirection="row" gap="sm">
                  <Button key={`${tab}:all-on`} label="All on" variant="secondary" onPress={() => stage(bulk, true)} />
                  <Button key={`${tab}:all-off`} label="All off" variant="secondary" onPress={() => stage(bulk, false)} />
                </Box>
              ) : null}
            </Box>

            <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="sm" marginTop="sm">
              <Text size="footnote" dimColor>Cost per session</Text>
              {badge(0, 'under 500')}
              {badge(LIGHT, '500 to 2k')}
              {badge(HEAVY, '2k+')}
            </Box>

            <Box flexDirection="column" rowGap="lg" marginTop="lg">
              {list.length === 0 ? (
                <Text size="footnote" dimColor wrap="wrap">
                  {{
                    plugin: 'No plugins installed.',
                    skill: 'No personal skills in ~/.claude/skills.',
                    mcp: 'Finding your MCP servers... the first look takes a few seconds.',
                  }[tab]}
                </Text>
              ) : (
                list.map(row)
              )}
            </Box>
          </>
        )}
      </Box>
    )
  })
}
